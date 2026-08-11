{{/*
Expand the name of the chart.
*/}}
{{- define "rig.fullname" -}}
{{- printf "%s-rig" .Release.Name -}}
{{- end -}}