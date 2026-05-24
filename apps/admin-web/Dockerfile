FROM node:20-alpine

WORKDIR /app

COPY apps/admin-web/package.json ./apps/admin-web/package.json
COPY apps/admin-web/server.js ./apps/admin-web/server.js

EXPOSE 3001

CMD ["node", "apps/admin-web/server.js"]
