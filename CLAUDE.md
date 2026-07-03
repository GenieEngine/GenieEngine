# About OpenGenie

OpenGenie is an AI-powered game engine that enables anyone to build their own video games. OpenGenie supports creation of 2D and 3D art assets, game logic, etc. OpenGenie games are powered by Godot engine under the hood. OpenGenie is a standalone application on Mac, Windows, and Linux (built on Electron).

## Functionality

The main interface of OpenGenie is a chat window on the far right side, and a viewer that runs the game in the middle of the screen. OpenGenie uses Godot's CLI to run the game and render it in the center of the screen. The user clicks the "play" button to start the game.

Additionally, the user can also click the Godot or VSCode buttons, which opens the codebase in the respective app. The source code of the game is only viewable when the user opens these views.

## Code Principles

1. Follow DRY principles. You should first search if there is another module / function that you can re-use (even by modifying / adding functionality to it) over creating new modules / functions.

2. Make sure to document your code, espeically reasons why you are making certain changes. This is especially applicable for bug fixes. Do not comment for the sake of commenting though - for instance when the code is self explanatory.

3. You should think carefully about how the code will scale, for instance when the codebase gets large, will the code still be clean? Always prioritize clean code. You may refactor the code as you see fit.
