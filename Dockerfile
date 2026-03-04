FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

COPY package.json package-lock.json* ./
# Copy schema before npm ci so postinstall (`prisma generate`) can find it.
COPY prisma ./prisma

# Install ALL dependencies (dev included) so vite + react-router build tools
# are available. postinstall automatically runs `prisma generate`.
RUN npm ci

COPY . .

# Build the app, then strip devDependencies to keep the image lean.
RUN npm run build && npm prune --omit=dev

# Set production env and SQLite path at runtime.
ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/prisma/dev.sqlite"

CMD ["npm", "run", "docker-start"]
