FROM docker.io/library/node:20-alpine
WORKDIR /app

# Serve the app under a path prefix (production uses /app; empty for dev builds).
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 5173
# next start serves the production build on 5173; rewrites proxy /api -> API_ORIGIN
CMD ["npm", "run", "start"]
