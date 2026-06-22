FROM docker.io/library/node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4000
# Runs migrations + (idempotent) seed, then starts the API.
CMD ["npm", "run", "start:docker"]
