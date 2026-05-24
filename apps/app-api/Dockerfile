FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY apps/app-api/package.json ./apps/app-api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm install --omit=dev
COPY apps/app-api/src ./apps/app-api/src
COPY packages/shared/src ./packages/shared/src

EXPOSE 4000

CMD ["node", "apps/app-api/src/index.js"]
