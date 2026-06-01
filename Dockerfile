# Playwright base image ships Chromium + all required system libraries.
# Pin the version to match the `playwright` npm dependency.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY plugins ./plugins
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
# Compiled output keeps the src/ + plugins/ layout under dist/.
COPY --from=build /app/dist ./dist
EXPOSE 8080
# config/ and plugins/ are mounted as volumes so devices/dashboards and custom
# plugins persist and can change without rebuilding the image.
VOLUME ["/app/config"]
CMD ["node", "dist/src/index.js"]
