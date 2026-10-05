#!/bin/sh
# Ordinary executable script, invoked directly after download.
printf 'Hello %s\n' "${1:-world}"
