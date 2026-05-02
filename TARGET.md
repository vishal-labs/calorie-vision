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