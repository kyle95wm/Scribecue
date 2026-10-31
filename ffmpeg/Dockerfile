# ffmpeg for Scribecue: turns the full mix into AAC, AC-3 or E-AC-3, and puts it into a
# copy of the video. At run time the container has no internet access (see
# docker-compose.yml) and is only reachable through Scribecue's own server. The video
# and the mix it's given are kept in the scribecue-ffmpeg volume only while it works.
FROM python:3.12-alpine3.20

RUN apk add --no-cache ffmpeg \
 && adduser -S -D -H -u 10001 ffmpeg \
 && mkdir /work && chown 10001 /work

COPY server.py /app/server.py
USER 10001
EXPOSE 5000
CMD ["python", "/app/server.py"]
