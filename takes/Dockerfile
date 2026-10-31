# Keeps a narrator's takes for Scribecue's Record mode on disk, in the scribecue-takes
# volume. At run time the container has no internet access (see docker-compose.yml) and
# is only reachable through Scribecue's own server.
FROM python:3.12-alpine3.20

RUN adduser -S -D -H -u 10001 takes \
 && mkdir /takes && chown 10001 /takes

COPY server.py /app/server.py
USER 10001
EXPOSE 5000
CMD ["python", "/app/server.py"]
