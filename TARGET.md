Here is what i want for as a website. 
1. An application which takes camera permission, and once the frame is set on the plate/food items, it should capture the image process it using gemma-4(add a env variable for the openrouter key) and let me know howmany calories that food item contains
along with the image, i can provide a small description(in an input box below the the live camera preview). so that The LLM can be more accurate on the calorie counting. 
2. Once the image is processed, and i get the calorie count, i should also be able to see the approximate breakdown of carbs, protein, and fats. and approximate weight of the food item
3. This app is only for me(personal use). There is only one thing more in this app, where i can set say 2000 calories per day, and after evey meat/food item that i add, those calories should be reduced from the 2000 limit.(or the limit that i can set in the setting/limit tab).

4. The UI should be minimal, simple, dark themed, easy to navigate and process. I should be able to see the progress of my daily calories intake.

5. The flow should be something like this: 
    1. I open the app. 
    2. I see a button which when clicked, starts camera preview where i can align the meal/food item in it. 
    3. Once aligned, i click a button to capture the image
    4. Once the image is clicked, i can add an optional description about the image
    5. The Optional description + image is sent to the LLM(which already has this system prompt)
    6. The response returned is the breakdown of each item it identifies in the image along with calorie, protein, carbs, fat and at the end, overall Calorie count. If it can, i should give suggestions like "If you can reduce the conumption of X, you can eat Y later" or something like that. 
    7. Finally, when i click Consume Button, it should subsract these calories from the limit that i set already(this limit can be changed dynamically)
6. Handle the memory of the app so that when i come back the next meal, it should be able to remember my new limit and say if i am getting overboard. 

### Technical Architecture
1. Use Python for backend(prefereably FastAPI) with clean simple endpoints. 
2. Use Simple Javascript, HTML, CSS for clean, modern Dark theme. 
3. Use LocalStorage to save the data (limit, consumed, remaining). 
4. Create a env file with an empty string to start with OPENROUTER_API_KEY= so that i can add it. 
5. Write tests to test the working of every button, dynamic variable. Use minimal dependencies as possible.
6. Use the existing UV venv for python development.
7. Prioritise the UI/UX giving constant feedback to the user. while also mantaining smooth operations and transitions between views. 

### Barcode scanning section
Here is what I want along with the current version of the app: A barcode scanner which can read the barcodes of the food items and give the approximate calorie count that are accurate to the actual product. The calorie and label details should be displayed along with the Item Name. 

But here is the additional feature that you have to do, classify the product into A, B, C, D, E (where A is the healthiest and E is the least healthiest). The color code should be Green, Light Green, Yellow, Orange, Red respectively. 
Along with the classification, also give a small description of why the product is classified as such.(I think some country follows this scoring system already) 

1. Breakdown this feature into smaller tasks and build a solid plan and execute it
2. Write tests to verify the progress and integrity of these new features
3. Choose your own method to get the Barcode details, Ig there is some open food labels dataset(live one ig) but feel free to search for existing ones and implement whatever you think is the easiest and best.   


### Database architecture. 
1. I want to move from localStorage to a database architecture. 
2. Where each user will have their own tables, each holding their daily log and preset information.
3. Also, there should be User signup/login feature. 
4. Any other Database schema/tables/features that you feel might be useful, implement those too. 
5. Use proper Database security and authentication, authorization. Make sure it is safe and secure from backend point of view. Like prevention of SQL injection, CSRF, etc..
6. Use RESTful API endpoints for all these features.
7. I want this entire database setup to be in the docker compose file as an other service, meaning once deployed, for the first time, it should setup the database automatically. and set a simple password(example: 'pass') as the default for all the user accounts, but once they try to login, prompt them to change the password. If there is any other better setup/migration setup feel free to implement it. 
8. Write a solid plan and break down this feature into smaller tasks and execute it. Write proper tests to verify the progress and integrity of these new features.
9. Split the entire section into smaller problems, while having a solid plan and tests at every step to check the integrity of the features that are new and existing. 

Finally, Update the Frontend with the required changes that's suitable for mobile view. do a little bit of polishing for the existing UI while keeping the entire UX more user friendly. 