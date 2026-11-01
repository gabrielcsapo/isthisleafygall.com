FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY scripts/ ./scripts/
COPY data/ ./data/
COPY dist/ ./dist/
RUN node scripts/prepare-runtime.mjs

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --chown=node:node server.mjs ./server.mjs
COPY --from=build --chown=node:node /app/dist/ ./dist/
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
