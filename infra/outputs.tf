output "url" {
  value = google_cloud_run_v2_service.app.uri
}

output "image_repository" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

output "demo_password_secret" {
  value       = google_secret_manager_secret.generated["demo-password"].secret_id
  description = "Read with: gcloud secrets versions access latest --secret <this>"
}
