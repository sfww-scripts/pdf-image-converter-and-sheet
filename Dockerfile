# Use Node.js LTS version
FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Set environment variable for Google Cloud authentication
# Note: You'll need to mount your credentials file when running the container
ENV GOOGLE_APPLICATION_CREDENTIALS="/app/credentials/google-credentials.json"

# Create directory for credentials
RUN mkdir -p /app/credentials

# Command to run the script
CMD ["npm", "start"]
