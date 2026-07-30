FROM denoland/deno:2.2.0
WORKDIR /app
COPY main.ts .
RUN deno cache main.ts
EXPOSE 8000
CMD ["run", "--allow-net", "--allow-env", "main.ts"]
