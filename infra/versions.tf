terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Configure a GCS backend before sharing state:
  # backend "gcs" { bucket = "<state-bucket>" prefix = "bordereau" }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
