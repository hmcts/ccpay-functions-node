variable "product" {
  type    = "string"
}

variable "component" {
  type    = "string"
}

variable "location" {
  type    = "string"
  default = "UK South"
}

variable "env" {
  type = "string"
}
variable "subscription" {
  type = "string"
}

variable "ilbIp"{}

variable "tenant_id" {}

variable "jenkins_AAD_objectId" {
  type                        = "string"
  description                 = "(Required) The Azure AD object ID of a user, service principal or security group in the Azure Active Directory tenant for the vault. The object ID must be unique for the list of access policies."
}

variable "common_tags" {
  type = "map"
}


variable "retry_schedule" {
  default = "0 */5 * * * *"
}

