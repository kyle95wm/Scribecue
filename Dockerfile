FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY app/ /usr/share/nginx/html/
# The guides, so they open inside Scribecue
COPY README.md GETTING-STARTED.md WRITING.md VOICES.md SHORTCUTS.md TRANSCRIBING.md RECORDING.md AI.md GOOGLE-VOICES.md INSTALL.md /usr/share/nginx/html/guides/
COPY docs/screenshots /usr/share/nginx/html/guides/docs/screenshots

EXPOSE 8080
