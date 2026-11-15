FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY app/ /usr/share/nginx/html/
# The branch this was built from, other than main, shown next to the version.
# scripts/docker-up.sh passes it; a plain build leaves it empty.
ARG BRANCH=
USER root
RUN if [ -n "$BRANCH" ]; then \
      case "$BRANCH" in *[!A-Za-z0-9._/-]*) echo "Bad branch name: $BRANCH"; exit 1;; esac; \
      sed -i "s|^export const BRANCH = '';|export const BRANCH = '$BRANCH';|" /usr/share/nginx/html/js/config.js && \
      grep -q "^export const BRANCH = '$BRANCH';" /usr/share/nginx/html/js/config.js; \
    fi
USER 101
# The guides, so they open inside Scribecue
COPY README.md FEATURES.md Guides/*.md /usr/share/nginx/html/guides/
COPY docs/screenshots /usr/share/nginx/html/guides/docs/screenshots
COPY docs/voices /usr/share/nginx/html/guides/docs/voices

EXPOSE 8080
