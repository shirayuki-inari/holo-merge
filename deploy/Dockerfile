FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY src/game ./src/game
COPY src/talents.json ./src/talents.json
RUN npm run server:build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/server-dist/node.mjs ./node.mjs
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/app/data/leaderboard.sqlite
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "node.mjs"]
