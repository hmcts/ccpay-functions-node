{{/*
Expand the name of the chart.
*/}}
{{- define "functional-test.fullname" -}}
{{- printf "%s-functional-test" .Release.Name -}}
{{- end -}}