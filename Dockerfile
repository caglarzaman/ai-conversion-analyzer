FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

COPY package.json package-lock.json* ./

# Install ALL dependencies (dev included) so vite + react-router build tools are available.
# postinstall automatically runs `prisma generate` here.
RUN npm ci

COPY . .

# Build the app, then strip devDependencies to keep the image lean.
RUN npm run build && npm prune --omit=dev

# Set production env at runtime, not during build.
ENV NODE_ENV=production

CMD ["npm", "run", "docker-start"]
