locals {
  name     = "bordereau"
  services = ["run.googleapis.com", "sqladmin.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "storage.googleapis.com", "aiplatform.googleapis.com"]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  repository_id = local.name
  format        = "DOCKER"
  location      = var.region
  depends_on    = [google_project_service.apis]
}

# ------------------------------------------------------------------ storage (uploaded bordereaux)

resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-${local.name}-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = !var.deletion_protection
  versioning { enabled = true }
  depends_on = [google_project_service.apis]
}

# ------------------------------------------------------------------ database

resource "google_sql_database_instance" "db" {
  name                = local.name
  database_version    = "POSTGRES_17"
  region              = var.region
  deletion_protection = var.deletion_protection
  # Cheap: shared-core tier, one zone, fixed 10 GB, no backups.
  settings {
    edition           = "ENTERPRISE"
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = false
    backup_configuration { enabled = false }
    ip_configuration { ipv4_enabled = true } # Cloud Run connects through the Cloud SQL connector, not an authorised network
  }
  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  name     = local.name
  instance = google_sql_database_instance.db.name
}

resource "random_password" "db" {
  length  = 32
  special = false # goes into a URL
}

resource "google_sql_user" "app" {
  name     = local.name
  instance = google_sql_database_instance.db.name
  password = random_password.db.result
}

# ------------------------------------------------------------------ secrets

resource "random_password" "session" {
  length  = 48
  special = false
}

resource "random_password" "demo" {
  length  = 16
  special = false
}

locals {
  generated_secrets = {
    # The host is a placeholder; the app connects over the socket in DB_SOCKET_DIR.
    "database-url"   = "postgres://${google_sql_user.app.name}:${random_password.db.result}@localhost/${google_sql_database.app.name}"
    "session-secret" = random_password.session.result
    "demo-password"  = random_password.demo.result
  }
}

resource "google_secret_manager_secret" "generated" {
  for_each  = local.generated_secrets
  secret_id = "${local.name}-${each.key}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "generated" {
  for_each    = local.generated_secrets
  secret      = google_secret_manager_secret.generated[each.key].id
  secret_data = each.value
}

# ------------------------------------------------------------------ runtime identity

resource "google_service_account" "app" {
  account_id   = "${local.name}-app"
  display_name = "Bordereau Cloud Run"
}

resource "google_project_iam_member" "sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_storage_bucket_iam_member" "uploads" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "access" {
  for_each  = { for k, s in google_secret_manager_secret.generated : k => s.id }
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# ------------------------------------------------------------------ Cloud Run

locals {
  socket_dir = "/cloudsql"
  env = {
    GOOGLE_CLOUD_PROJECT = var.project_id
    STORAGE_DRIVER       = "gcs"
    GCS_BUCKET           = google_storage_bucket.uploads.name
    DB_SOCKET_DIR        = "${local.socket_dir}/${google_sql_database_instance.db.connection_name}"
  }
  secret_env = {
    DATABASE_URL   = google_secret_manager_secret.generated["database-url"].secret_id
    SESSION_SECRET = google_secret_manager_secret.generated["session-secret"].secret_id
    DEMO_PASSWORD  = google_secret_manager_secret.generated["demo-password"].secret_id
  }
}

resource "google_cloud_run_v2_service" "app" {
  name                = local.name
  location            = var.region
  deletion_protection = var.deletion_protection
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.app.email
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance { instances = [google_sql_database_instance.db.connection_name] }
    }
    containers {
      image = var.image
      ports { container_port = 8080 }
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = local.socket_dir
      }
      startup_probe {
        http_get { path = "/api/health" }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.access, google_project_iam_member.sql_client, google_project_iam_member.vertex_user, google_secret_manager_secret_version.generated]
}

# The app has its own demo login, so the service itself is public.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Applies migrations and loads the demo insurers:
#   gcloud run jobs execute bordereau-prepare-db --region <region> --wait
resource "google_cloud_run_v2_job" "prepare_db" {
  name                = "${local.name}-prepare-db"
  location            = var.region
  deletion_protection = var.deletion_protection
  template {
    template {
      service_account = google_service_account.app.email
      max_retries     = 0
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.db.connection_name] }
      }
      containers {
        image   = var.image
        command = ["sh", "-c", "node dist-scripts/migrate.mjs && node dist-scripts/seed.mjs --force"]
        dynamic "env" {
          for_each = local.env
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = local.secret_env.DATABASE_URL
              version = "latest"
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = local.socket_dir
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.access, google_project_iam_member.sql_client, google_secret_manager_secret_version.generated]
}
