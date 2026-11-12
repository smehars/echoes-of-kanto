import "./App.css";
import { useState, useEffect, useMemo, useRef } from "react";
import Analyzer from "./components/analyzer";
import TYPE_COLORS from "./utils/typeColors";

const MAX_ROUNDS = 5;

// National Pokédex number ranges for each generation
const GENERATIONS = [
  [1, 151],
  [152, 251],
  [252, 386],
  [387, 493],
  [494, 649],
  [650, 721],
  [722, 809],
  [810, 905],
  [906, 1025],
];
const LAST_ID = GENERATIONS[GENERATIONS.length - 1][1];

function inGenerations(id, gens) {
  return gens.some((g) => id >= GENERATIONS[g - 1][0] && id <= GENERATIONS[g - 1][1]);
}

// Random Pokémon from the chosen generations that hasn't come up yet.
// Once every one has been seen, the chosen generations start over.
function pickPokemonId(gens, seen) {
  const all = [];
  for (let id = 1; id <= LAST_ID; id++) {
    if (inGenerations(id, gens)) all.push(id);
  }
  let pool = all.filter((id) => !seen.has(id));
  if (pool.length === 0) {
    all.forEach((id) => seen.delete(id));
    pool = all;
  }
  const id = pool[Math.floor(Math.random() * pool.length)];
  seen.add(id);
  return id;
}

function loadGenerations() {
  try {
    const saved = JSON.parse(localStorage.getItem("generations"));
    const valid = Array.isArray(saved)
      ? saved.filter((g) => Number.isInteger(g) && g >= 1 && g <= GENERATIONS.length)
      : [];
    return valid.length > 0 ? valid : [1];
  } catch {
    return [1];
  }
}

function loadNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  const value = Number(raw);
  return raw !== null && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function App() {
  const analyzerRef = useRef(null);
  const inputRef = useRef(null);
  const seenRef = useRef(new Set());
  const focusGuessRef = useRef(false);

  // generations ticked in the settings, and the ones the current round was drawn from
  const [gens, setGens] = useState(loadGenerations);
  const [roundGens, setRoundGens] = useState(gens);
  const [pokemonId, setPokemonId] = useState(() => pickPokemonId(gens, new Set()));
  const [pokemon, setPokemon] = useState(null);
  const [allPokemon, setAllPokemon] = useState([]);

  const [round, setRound] = useState(1);
  const [guess, setGuess] = useState("");
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(true);

  const [streak, setStreak] = useState(() => loadNumber("streak", 0));
  const [bestStreak, setBestStreak] = useState(() => loadNumber("bestStreak", 0));
  const [classicCries, setClassicCries] = useState(() => localStorage.getItem("classicCries") === "true");
  const [volume, setVolume] = useState(() => Math.min(loadNumber("volume", 40), 100));
  // squared so the slider feels even to the ear
  const gain = (volume / 100) ** 2;

  function handleVolumeChange(e) {
    const next = Number(e.target.value);
    setVolume(next);
    localStorage.setItem("volume", String(next));
  }

  function toggleGeneration(g) {
    const next = gens.includes(g) ? gens.filter((x) => x !== g) : [...gens, g].sort((x, y) => x - y);
    if (next.length === 0) return; // always keep at least one
    setGens(next);
    localStorage.setItem("generations", JSON.stringify(next));
  }

  function toggleClassicCries(e) {
    setClassicCries(e.target.checked);
    localStorage.setItem("classicCries", String(e.target.checked));
  }

  // fetch the Pokémon for this round
  useEffect(() => {
    let cancelled = false;
    seenRef.current.add(pokemonId);
    fetch(`https://pokeapi.co/api/v2/pokemon/${pokemonId}/`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setPokemon({
          id: pokemonId,
          name: data.species?.name || data.name,
          types: data.types.map((t) => t.type.name),
          cries: { latest: data.cries?.latest || null, legacy: data.cries?.legacy || null },
          sprite: data.sprites?.front_default || null,
        });
      })
      .catch((error) => {
        console.error("Error fetching Pokemon data:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [pokemonId]);

  // names for the autocomplete, in Pokédex order
  useEffect(() => {
    fetch(`https://pokeapi.co/api/v2/pokemon-species?limit=${LAST_ID}`)
      .then((res) => res.json())
      .then((data) => setAllPokemon(data.results.map((p) => p.name)))
      .catch((error) => console.error("Error fetching all Pokemon:", error));
  }, []);

  // ignore the previous round's data while the next one loads
  const current = pokemon && pokemon.id === pokemonId ? pokemon : null;
  const pokemonName = current?.name ?? "";
  const spriteUrl = current?.sprite ?? null;
  // classic cries only exist for older Pokémon, so fall back to the modern one
  const audioUrl = current
    ? (classicCries && current.cries.legacy) || current.cries.latest || current.cries.legacy
    : null;

  const suggestions = guess.trim().length > 0 && !gameOver && showDropdown
    ? allPokemon
        .filter((name, i) => inGenerations(i + 1, roundGens) && name.startsWith(guess.toLowerCase().trim()))
        .slice(0, 5)
    : [];

  function updateStreak(next) {
    setStreak(next);
    localStorage.setItem("streak", String(next));
    if (next > bestStreak) {
      setBestStreak(next);
      localStorage.setItem("bestStreak", String(next));
    }
  }

  function handleGuess(overrideGuess) {
    const finalGuess = (typeof overrideGuess === "string" ? overrideGuess : guess).toLowerCase().trim();
    if (!finalGuess || !current) return;
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
      updateStreak(streak + 1);
    } else{
      const wrongSound = new Audio("/fahhhhhhhhhhhhhh.mp3");
      wrongSound.volume = gain;
      wrongSound.play().catch((error) => {
        console.error("Error playing sound:", error);
      });
      if (round >= MAX_ROUNDS) {
        setGameOver(true);
        updateStreak(0);
      } else {
        setRound((prev) => prev + 1);
      }
    }
    setGuess("");
  }

  function getNewPokemon() {
    setRoundGens(gens);
    setPokemonId(pickPokemonId(gens, seenRef.current));
    setRound(1);
    setGuess("");
    setGameOver(false);
    setWon(false);
    setActiveSuggestion(-1);
  }

  // Keyboard shortcuts: Space plays the cry, Enter starts the next Pokémon
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target.tagName;
      const onControl = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(tag);
      if (e.code === "Space" && !onControl) {
        e.preventDefault();
        analyzerRef.current?.playAudio();
      } else if (e.key === "Enter" && gameOver && !onControl) {
        e.preventDefault();
        focusGuessRef.current = true;
        getNewPokemon();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // after starting a round from the keyboard, put the cursor in the guess box
  useEffect(() => {
    if (!gameOver && focusGuessRef.current) {
      focusGuessRef.current = false;
      inputRef.current?.focus();
    }
  }, [gameOver, pokemonId]);

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
  // (memoised so the graph is only rebuilt when the Pokémon changes)
  const terrainColors = useMemo(
    () =>
      current && current.types.length > 0
        ? current.types.map((t) => TYPE_COLORS[t] || "#81A596")
        : ["#81A596"],
    [current]
  );

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
            <p className="streak">Streak {streak} · Best {bestStreak}</p>
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
                  ref={inputRef}
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

          <fieldset className="gen-control">
            <legend>Generations</legend>
            <div className="gen-chips">
              {GENERATIONS.map((_, i) => (
                <label key={i + 1} className="gen-chip">
                  <input
                    type="checkbox"
                    checked={gens.includes(i + 1)}
                    onChange={() => toggleGeneration(i + 1)}
                    aria-label={`Generation ${i + 1}`}
                  />
                  <span>{i + 1}</span>
                </label>
              ))}
            </div>
            {gens.join() !== roundGens.join() && (
              <p className="settings-note">Applies from the next Pokémon</p>
            )}
          </fieldset>

          <label className="cries-control">
            <input type="checkbox" checked={classicCries} onChange={toggleClassicCries} />
            <span>Classic cries</span>
          </label>

        </div>
      </div>

      <div className="bottom-bar">
      <div className="help">
        <button type="button" className="help-button" aria-label="How to play" aria-describedby="help-panel">?</button>
        <div className="help-panel" id="help-panel" role="tooltip">
          <h2>How to play</h2>
          <p>Press Play Audio to hear a Pokémon's cry, then guess who it is. You get {MAX_ROUNDS} guesses.</p>
          <p>The terrain is the cry's shape, coloured by the Pokémon's type. Drag it to rotate.</p>
          <p>Each wrong guess unlocks a hint:</p>
          <ol>
            <li>Number of letters</li>
            <li>First letter</li>
            <li>Silhouette</li>
            <li>Full sprite</li>
          </ol>
          <p>Shortcuts: Space plays the cry, Enter starts the next Pokémon.</p>
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
