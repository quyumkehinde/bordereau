variable "project_id" {
  type        = string
  description = "GCP project to deploy into"
}

variable "region" {
  type    = string
  default = "europe-west2" # London
}

variable "image" {
  type        = string
  description = "Container image, e.g. europe-west2-docker.pkg.dev/<project>/bordereau/app:<sha>"
}

variable "db_tier" {
  type    = string
  default = "db-f1-micro"
}

variable "deletion_protection" {
  type    = bool
  default = true
}
