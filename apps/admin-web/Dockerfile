FROM node:20-alpine

WORKDIR /app

COPY apps/admin-web/package.json ./apps/admin-web/package.json
COPY apps/admin-web/*.js ./apps/admin-web/
COPY apps/worker/src ./apps/worker/src
COPY packages/shared/src ./packages/shared/src

EXPOSE 3001

CMD ["node", "apps/admin-web/server.js"]
