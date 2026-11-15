FROM oven/bun:1-alpine

WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock ./

# Install production and build dependencies
RUN bun install --frozen-lockfile

# Copy source code and configuration
COPY tsconfig.json ./
COPY src ./src

EXPOSE 3000

CMD ["bun", "run", "src/main.ts"]
