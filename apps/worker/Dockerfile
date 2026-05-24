FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm install --omit=dev
COPY apps/worker/src ./apps/worker/src
COPY packages/shared/src ./packages/shared/src

CMD ["node", "apps/worker/src/index.js"]
