FROM docker.io/library/node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 5173
# next start serves the production build on 5173; rewrites proxy /api -> API_ORIGIN
CMD ["npm", "run", "start"]
