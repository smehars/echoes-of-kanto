import "./App.css";
import { useState, useEffect, useRef } from "react";
import Analyzer from "./components/analyzer";
import TYPE_COLORS from "./utils/typeColors";

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function App() {
  const analyzerRef = useRef(null);
  const [pokemonID, setPokemonID] = useState(getRandomInt(1, 152));
  const [pokemonName, setPokemonName] = useState("");
  const [pokemonTypes, setPokemonTypes] = useState([]);
  const [audioUrl, setAudioUrl] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [round, setRound] = useState(1);
  const [guess, setGuess] = useState("");
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [spriteUrl, setSpriteUrl] = useState(null);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("volume"));
    return saved >= 0 && saved <= 100 && localStorage.getItem("volume") !== null ? saved : 40;
  });
  // squared so the slider feels even to the ear
  const gain = (volume / 100) ** 2;

  function handleVolumeChange(e) {
    const next = Number(e.target.value);
    setVolume(next);
    localStorage.setItem("volume", String(next));
  }

  const[allPokemon, setAllPokemon] = useState([]);

  const MAX_ROUNDS = 5;

  function fetchPokemonName(id = pokemonID) {
    const url = `https://pokeapi.co/api/v2/pokemon/${id}/`;
    fetch(url)
      .then((response) => response.json())
      .then((data) => {
        setPokemonName(data.name);
        setPokemonTypes(data.types.map((t) => t.type.name));
        setAudioUrl(data.cries?.latest || data.cries?.legacy || null);
        setSpriteUrl(data.sprites?.front_default || null);
      })
      .catch((error) => {
        console.error("Error fetching Pokemon data:", error);
      });
  }

  // useEffect runs once on page load/reload
  useEffect(() => {
    fetchPokemonName();
    fetch("https://pokeapi.co/api/v2/pokemon?limit=151")
      .then((res) => res.json())
      .then((data) => setAllPokemon(data.results.map(p => p.name)))
      .catch((error) => console.error("Error fetching all Pokemon:", error))
  }, []);

  const [showDropdown, setShowDropdown] = useState(true);

  const suggestions = guess.trim().length > 0 && !gameOver && showDropdown
    ? allPokemon.filter(name => name.startsWith(guess.toLowerCase())).slice(0, 5)
    : [];

  function handleGuess(overrideGuess) {
    const finalGuess = (typeof overrideGuess === "string" ? overrideGuess : guess).toLowerCase().trim();
    if (!finalGuess) return;
    setActiveSuggestion(-1);
    if (finalGuess === pokemonName.toLowerCase()) {
      // correct guess
      const rightSound = new Audio("/yayyyyyyyy.mp3");
      rightSound.volume = gain;
      rightSound.play().catch((error) => {
        console.error("Error playing sound:", error);
      });
      setWon(true);
      setGameOver(true);
      setRevealed(true);
    } else{
      const wrongSound = new Audio("/fahhhhhhhhhhhhhh.mp3");
      wrongSound.volume = gain;
      wrongSound.play().catch((error) => {
        console.error("Error playing sound:", error);
      });
      if (round >= MAX_ROUNDS) {
        setGameOver(true);
        setRevealed(true);
      } else {
        setRound((prev) => prev + 1);
      }
    }
    setGuess("");
  }

  function getNewPokemon() {
    const newID = getRandomInt(1, 152);
    setPokemonID(newID);
    fetchPokemonName(newID);
    setRevealed(false);
    setAudioUrl(null);
    setSpriteUrl(null);
    setRound(1);
    setGuess("");
    setGameOver(false);
    setWon(false);
    setActiveSuggestion(-1);
  }

  function handleInputKeyDown(e) {
    if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setActiveSuggestion((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length > 0) {
      e.preventDefault();
      setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setActiveSuggestion(-1);
    } else if (e.key === "Enter" && guess.trim()) {
      handleGuess(activeSuggestion >= 0 ? suggestions[activeSuggestion] : guess);
    }
  }

  // Build terrain colors — always show type colors (that's the round 1 base hint)
  const terrainColors =
    pokemonTypes.length > 0
      ? pokemonTypes.map((t) => TYPE_COLORS[t] || "#81A596")
      : ["#81A596"];

  // Hint helpers
  const showLetterCount = round >= 2;      // Round 2+
  const showFirstLetter = round >= 3;      // Round 3+
  const showSilhouette = round >= 4;       // Round 4+
  const showFullSprite = round >= MAX_ROUNDS || gameOver;       // Round 5 or gameover

  // Build the name hint
  const nameHint = (() => {
    if (showFirstLetter) {
      return pokemonName.charAt(0).toUpperCase() + " _ ".repeat(pokemonName.length - 1).trim();
    }
    if (showLetterCount) {
      return "_ ".repeat(pokemonName.length).trim();
    }
    return null;
  })();

return (
    <div id="main-div">
      <header className="device-header">
        <div className="device-lights" aria-hidden="true">
          <span className="lens" />
          <span className="led led-red" />
          <span className="led led-yellow" />
          <span className="led led-green" />
        </div>
        <h1>Pokémon: Echoes of Kanto</h1>
      </header>

      <div className="game-layout">

        <div className="canvas-section">
          <Analyzer ref={analyzerRef} audioUrl={audioUrl} terrainColors={terrainColors} volume={gain} />
        </div>

        <div className="ui-section">

          <button className="primary-button" style={{ width: "100%" }} onClick={() => analyzerRef.current?.playAudio()}>
            Play Audio
          </button>

          <div className="hints-area">
            <p className="round-indicator">Round {round} / {MAX_ROUNDS}</p>
            {!gameOver && (
              <p className="dialog-text">
                {round === 1 ? "A wild cry echoes… Who could it be?" : "Not quite! Here's a hint."}
              </p>
            )}
            {nameHint && (
              <>
                <p className="hint-text">{nameHint}</p>
                <p className="hint-count">{pokemonName.length} letters</p>
              </>
            )}
            {spriteUrl && (showSilhouette || showFullSprite) && (
              <div className="sprite-container">
                <img
                  src={spriteUrl}
                  alt="Pokemon hint"
                  className="pokemon-sprite"
                  style={{
                    filter: showFullSprite ? "none" : "brightness(0)",
                    width: "120px",
                    imageRendering: "pixelated",
                  }}
                />
              </div>
            )}
          </div>

          {!gameOver ? (
            <div className="guess-area">
              <div className="guess-field">
                <input
                  type="text"
                  value={guess}
                  onChange={(e) => {
                    setGuess(e.target.value);
                    setShowDropdown(true);
                    setActiveSuggestion(-1);
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Enter Pokémon name..."
                  className="guess-input"
                  autoComplete="off"
                  aria-label="Your guess"
                />
                {suggestions.length > 0 && (
                  <ul className="autocomplete-dropdown">
                    {suggestions.map((name, i) => (
                      <li
                        key={name}
                        className={i === activeSuggestion ? "active" : undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleGuess(name)}
                      >{name}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                className="primary-button"
                style={{ width: "100%" }}
                onClick={() => handleGuess(guess)}
                disabled={guess.trim() === ""}
              >
                Guess
              </button>
            </div>
          ) : (
            <div className="result-area">
              {won ? (
                <p className="result-text win">Gotcha! It was <span className="poke-name">{pokemonName}</span>!</p>
              ) : (
                <p className="result-text lose">It got away… It was <span className="poke-name">{pokemonName}</span>!</p>
              )}
              <button className="primary-button" onClick={getNewPokemon}>
                New Pokemon
              </button>
            </div>
          )}

          <label className="volume-control">
            <span>Volume</span>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolumeChange}
              className="volume-slider"
            />
          </label>

        </div>
      </div>

      <div className="bottom-bar">
      <div className="help">
        <button type="button" className="help-button" aria-label="How to play" aria-describedby="help-panel">?</button>
        <div className="help-panel" id="help-panel" role="tooltip">
          <h2>How to play</h2>
          <p>Press Play Audio to hear a Kanto Pokémon's cry, then guess who it is. You get {MAX_ROUNDS} guesses.</p>
          <p>The terrain is the cry's shape, coloured by the Pokémon's type. Drag it to rotate.</p>
          <p>Each wrong guess unlocks a hint:</p>
          <ol>
            <li>Number of letters</li>
            <li>First letter</li>
            <li>Silhouette</li>
            <li>Full sprite</li>
          </ol>
        </div>
      </div>

      <footer className="credits-footer">
        <span className="credits-text">Made by Mehar :)</span>
        <a href="https://github.com/smehars" target="_blank" rel="noopener noreferrer" className="credits-link" aria-label="GitHub">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.605-.015 2.896-.015 3.286 0 .315.21.694.825.576C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"/></svg>
        </a>
        <a href="https://www.linkedin.com/in/smeharsaini/" target="_blank" rel="noopener noreferrer" className="credits-link" aria-label="LinkedIn">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        </a>
      </footer>
      </div>
    </div>
  );
}

export default App;
