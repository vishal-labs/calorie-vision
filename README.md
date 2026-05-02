1. Add the API key for openrouter in the .env file in the src folder
2. The model currently is set to the free version of Gemma-4 on openrouter, so no issue from that side
3. Finally use the command `docker compose up --build -d` to build and run the application  
4. If you want to, change the port mapping for the host port in the docker-compose.yml file.
5. The application can be accessed at the host port number and the path `/`. Or use `docker ps`to get the list of running containers and find the port mapping for the container.
