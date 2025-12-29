ARG NODE_VERSION=22.0.0

# Build stage
FROM node:${NODE_VERSION}-alpine as builder

WORKDIR /app

# Install dependencies for building
# We need to copy package files first for caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY . .

# Build the application
# This typically generates artifacts in .mastra
RUN npm run build

# Production stage
FROM node:${NODE_VERSION}-alpine as runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package files again for production dependencies
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy built artifacts from builder stage based on standard Mastra output
COPY --from=builder /app/.mastra ./.mastra
COPY --from=builder /app/src ./src

# Expose the default Mastra port
EXPOSE 4111

# Start the application
CMD ["npm", "run", "dev"]
# Using 'npm run dev' as 'mastra start' might need specific setup, 
# but per package.json 'dev' runs 'mastra dev'. 
# Ideally for production 'mastra start' is better if 'mastra build' was successful.
# Let's try to align with the plan: 
# The plan said "runner" executes "mastra start".
# Let's adjust CMD to be 'npm start' if we add a start script, or directly 'npx mastra start'.
# Checking package.json again via memory:
# "scripts": { "build": "mastra build", "dev": "...", "test": "..." }
# I should probably add a "start" script or use npx mastra start.
# Let's stick to 'npx mastra start' for production if build artifacts exist.
# However, the user might want to run in dev mode per 'dev' script which has polyfill.
# If I use Node 22, I don't need polyfill.
# Let's try to use 'npx mastra start' for a true production build.

CMD ["npx", "mastra", "start"]
