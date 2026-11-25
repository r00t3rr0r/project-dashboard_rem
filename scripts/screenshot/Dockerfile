FROM mcr.microsoft.com/playwright:v1.57.0-noble
WORKDIR /app
RUN npm install --omit=dev --no-audit --no-fund playwright@1.57.0
COPY capture.js /app/capture.js
USER 10001:10001
ENTRYPOINT ["node", "/app/capture.js"]
