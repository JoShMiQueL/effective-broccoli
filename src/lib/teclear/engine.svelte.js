// ---------- Motor del juego ----------
// GameEngine orquesta el ciclo de juego: estado (S), modos (modes),
// servicios (fx/eco/prog/acc/ranking) y view-models para la vista.
// engine.mount() se llama una vez desde +page.svelte al montar la página.
import imgLogo from '#lib/img/estesoTeclea.png';
import { getSetting, setSetting } from './settings.js';
import { S } from './state.svelte.js';
import { storage } from './storage.js';
import { fx } from './services/fx.js';
import { uiLang, t } from './services/i18n.js';
import { eco } from './services/economy.js';
import { prog } from './services/progression.js';
import * as identity from './services/identity.js';
import { ranking } from './services/ranking.svelte.js';
import { acc } from './services/account.js';
import { modes } from './modes/index.js';
import { abilities } from './services/abilities.js';
import {
    GAME_TIME, MAX_MISSES, SPEEDRUN_MS, BONUS_TIME_ELPRICO, SOUP_GIVEN,
    TURBO_MAX, SUP_LIVES, SUP_XP_WORD,
    RANK_URL, RANK_ADV_URL, NAMES_URL, RESETS_URL, RANK_MAX, NAMES_MAX,
    RANK_TIMEOUT, NAME_MAX, MAX_SCORE, MAX_WORDS, PTS_PER_WORD, SCORE_BOOST,
    SEAL_SALT, PROFILES_URL, PASS_MIN, KDF_ROUNDS
} from './data/constants.js';
import {
    WORDS, MURCIANO_WORDS, PICANTE, PHP_WORDS, ANDALUZ_WORDS,
    MINECRAFT_WORDS, HALLOWEEN_WORDS
} from './data/words.js';
import { TT_TIME_PENALTY, TT_XP_PENALTY } from './data/events.js';
import { events } from './services/events.svelte.js';
import { ACHIEVEMENTS } from './data/achievements.js';
import { I18N } from './data/i18n.js';
import { VEYON_PLACEHOLDER, VEYON_FAVICON } from './data/veyon.js';

const LOGO_PHRASES = [
            "arreglo", "IA", "veyon", "va a botarlo", "yo soy la IA", "enseñe su array"
        ];

export class GameEngine {
    // Estado reactivo compartido (engine.state.score, engine.state.mode…)
    state = S;
    // i18n: engine.t("clave") en las plantillas
    get t() { return t; }

    // ---------- Interno (no reactivo) ----------
    ttXpLoss = 0;
    lastTick = 0;
    timerId = null;
    extraRun = null;
    srAt = 0;
    srWords = 0;
    savedScore = $state(false);
    gameStartAt = 0;
    gameDuration = 0;
    logoLast = -1;
    logoHide = 0;

    // ---------- Elementos del DOM (se enlazan en mount) ----------
    stage;
    board;
    typing;
    logros;
    inventario;
    perfil;
    accName;
    accPass;
    accPass2;
    rankingEl;
    verifyInput;
    logoBtn;

    // ---------- View-models (getters: la lectura suscribe al $state) ----------
    get uiEn() { return uiLang() === "en"; }

    get subtitle() { return S.mode === "imagen" ? t("subtitleI") :
                             S.mode === "guess" ? t("subtitleG") :
                             S.mode === "aventura" ? t("subtitleA") :
                             S.mode === "supervivencia" ? t("subtitleS") :
                             S.lang === "mur" ? t("subtitleM") : t("subtitleT"); }

    get streakTxt() { return S.streak + " (x" + this.multiplier() + ")"; }

    get timeTxt() { return Math.max(0, Math.ceil(S.timeLeft)); }

    get timeLow() { return S.state === "playing" &&
                             (S.mode === "supervivencia" ? S.timeLeft <= 4 : S.timeLeft <= 10); }

    get coinsTxt() { return eco.fmtCoins(S.coins); }

    get accHintTxt() { return S.accSession ? t("accDataHint") : t("accHint"); }

    get btnRegTxt() { return S.accSession ? t("btnProfile") : t("btnRegister"); }

    get candyTxt() { return eco.fmtCandy(S.caramelos); }

    get achCountTxt() { return Object.values(S.achData).filter(d => d.done).length +
                             "/" + ACHIEVEMENTS.length; }

    get invCountTxt() { return eco.invItems().length; }

    get playing() { return S.state === "playing"; }

    get typingDis() { return S.state !== "playing" || S.perkOpen; }

    get esAdmin() { return acc.esAdmin(); }

    get accWhoTxt() { return S.accSession ? t("accWho") + S.accSession.n : "-"; }

    get accSubmitTxt() { return S.accMode === "reg" ? t("accSubmitReg") : t("accSubmitLogin"); }

    get accSwitchTxt() { return S.accMode === "reg" ? t("accSwitchToLogin") : t("accSwitchToReg"); }

    get rankWhoTxt() { return S.accSession ? t("accRankWith") + S.accSession.n : t("accRankNo"); }

    get supTargetN() { return modes.supervivencia.target ? modes.supervivencia.target.n : -1; }

    get supMax() { return SUP_LIVES; }

    get boardView() {
                if (S.state !== "playing") {
                    return { kind: "hint", txt: S.state === "over" ? t("boardEnd") : t("boardIdle") };
                }
                // Los modos con tablero propio devuelven su vista
                const mv = modes[S.mode].boardView();
                if (mv) return mv;
                return { kind: "letters", letters: S.word.split("").map((ch, i) => ({
                    ch: ch,
                    cls: i < S.typedStr.length ? (S.typedStr[i] === ch ? "ok" : "bad")
                         : (i === S.typedStr.length ? "cursor" : "")
                })) };
            }

    get missesView() { return modes[S.mode].missesView() ?? { kind: "off" }; }

    get maxMisses() { return MAX_MISSES; }

    get advChips() {
                S.timeLeft;
                if (S.mode !== "aventura") return [];
                return modes.aventura.chips();
            }

    // Las cuatro secciones de la tienda salen del registro de tipos de
    // economy.js — añadir una categoría es darla de alta allí y repetir
    // la sección en Shop.svelte
    get shopFonts() { return eco.shopCards("font"); }

    get shopBgs() { return eco.shopCards("bg"); }

    get shopExtras() { return eco.shopCards("extra"); }

    get shopFxs() { return eco.shopCards("fx"); }

    // La tienda de evento lista lo que declara el registro del evento
    // activo (data/events.js): fondo + efecto + extra, en caramelos
    get shopEvents() { return eco.eventCards(); }

    get invSections() {
                const items = eco.invItems();
                const esEvento = it => it.event === events.activeId();
                return [
                    { key: "event", title: t("invEventTitle"),
                      items: items.filter(esEvento) },
                    { key: "font", title: t("invFontsTitle"),
                      items: items.filter(it => it.tipo === "font" && !esEvento(it)) },
                    { key: "bg", title: t("invBgsTitle"),
                      items: items.filter(it => it.tipo === "bg" && !esEvento(it)) },
                    { key: "extra", title: t("invExtrasTitle"),
                      items: items.filter(it => it.tipo === "extra" && !esEvento(it)) },
                    { key: "fx", title: t("invFxTitle"),
                      items: items.filter(it => it.tipo === "fx" && !esEvento(it)) }
                ];
            }

    get achCards() { return ACHIEVEMENTS.map(a => {
                const d = S.achData[a.id] || { p: 0, done: false };
                return {
                    id: a.id, icon: a.icon,
                    name: uiLang() === "es" ? a.es : a.en,
                    desc: uiLang() === "es" ? a.descEs : a.descEn,
                    p: d.p, goal: a.goal,
                    pct: Math.round((d.p / a.goal) * 100),
                    done: !!d.done, reward: prog.rewardLabel(a)
                };
            }); }

    get rank() { return ranking.rankData; }

    get myId() { return identity.currentPlayerId(); }

    get rankDate() { return ranking.rankDate; }

    get modeOptions() { return [{ v: "", txt: t("modeClassic") }]
                .concat(eco.all("extra").filter(x => eco.ownsExtra(x.id))
                    .map(x => ({ v: x.id, txt: x.icon + " " + (uiLang() === "es" ? x.es : x.en) }))); }

    get modeSel() { return eco.activeExtraId(); }

    get modeSelDis() { return eco.all("extra").every(x => !eco.ownsExtra(x.id)) ||
                             S.mode !== "type" || S.state === "playing"; }

    get modeSelTitle() { return eco.all("extra").every(x => !eco.ownsExtra(x.id)) ? t("modeSelectEmpty")
                             : (S.mode !== "type" ? t("modeSelectOff") : t("modeSelectHint")); }

    get supOptions() {
                const out = [{ v: "clasico", txt: t("supVarClasico") }];
                // La variante del evento activo (registro data/events.js)
                const v = events.active?.supVariant;
                if (v) out.push({ v, txt: t("supVar" + v[0].toUpperCase() + v.slice(1)) });
                return out;
            }

    get supSelDis() { return S.mode !== "supervivencia" || S.state === "playing"; }

    get supSelTitle() { return S.mode !== "supervivencia" ? t("supSelectOff") : t("supVarHint"); }

    get veyonImg() { return VEYON_PLACEHOLDER; }

    // Botón de la habilidad del fondo (junto al campo de escritura).
    // S.supTick lo refresca con cada pulso: lleva la cuenta atrás
    get abilityView() {
            S.supTick;
            return abilities.view();
        }

    // Botón de la fila «Controles»: la tecla reservada, o «pulsa una
    // tecla…» mientras espera la reasignación
    get ctrlKeyTxt() {
            return S.bindingKey ? "⌨️ " + t("ctrlKeyWait")
                                : "⚡ " + t("ctrlKey") + ": " + abilities.keyLabel(S.abilityKey);
        }

    // ---------- Ciclo de juego y utilidades ----------
    toggleRanking(tab) {
            if (S.state === "playing") return;
            S.rankOpen = !S.rankOpen;
            if (S.rankOpen) {
                ranking.refreshRanking();
                // Si se guarda una marca, su tabla se resalta (una partida de
                // Aventura se mira en el ranking de Aventura, no en el global)
                if (tab) S.rankFocus = tab;
                // El panel queda por debajo: se lleva a la vista para que se note
                if (this.rankingEl && this.rankingEl.scrollIntoView) {
                    this.rankingEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
            }
        }

    encOn() {
            // ¿La variante del evento está jugándose? (la define el registro
            // de eventos; el modo la conoce como su variante "encantada")
            return S.mode === "supervivencia" && modes.supervivencia.enc;
        }

    setSupVariant(v) {
            if (S.state === "playing") return;
            // La variante solo se puede elegir si el evento activo la ofrece
            S.supVariant = (v === "clasico" || events.active?.supVariant === v)
                ? v : "clasico";
            try {
                storage.set("teclear.supVariante", S.supVariant);
            } catch (e) { /* sin almacenamiento disponible */ }
        }

    toggleShop() {
            if (S.state === "playing") return;
            S.shopOpen = !S.shopOpen;
            if (S.shopOpen) S.shopMsgTxt = "";
        }

    toggleLogros() {
            if (S.state === "playing") return;
            S.logrosOpen = !S.logrosOpen;
            if (S.logrosOpen && this.logros.scrollIntoView) {
                // El panel queda por debajo: se lleva a la vista para que se note
                this.logros.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
        }

    closeLogrosOnPlay() {
            if (!S.logrosOpen) return;
            S.logrosOpen = false;
        }

    toggleInv() {
            if (S.state === "playing") return;
            S.invOpen = !S.invOpen;
            if (S.invOpen) {
                S.invMsgTxt = "";   // aviso de la acción anterior
                // El panel queda por debajo: se lleva a la vista para que se note
                if (this.inventario.scrollIntoView) {
                    this.inventario.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
            }
        }

    closeInvOnPlay() {
            if (!S.invOpen) return;
            S.invOpen = false;
        }

    applyLang() {
            document.documentElement.lang = uiLang();
            document.title = t("docTitle");

            // En Aventura no se juega con fondos: el cuerpo lleva el fondo
            // propio del modo (sin habilidad)
            const sinFondos = S.mode === "aventura";
            eco.all("bg").forEach(b => {
                document.body.classList.toggle("bg-" + b.id, !sinFondos && S.bg === b.id);
            });
            document.body.classList.toggle("bg-aventura", sinFondos);
            fx.syncLetterSoup(!sinFondos && S.bg === "sopa");   // letras rebotando solo con ese fondo
            fx.syncHacker(!sinFondos && S.bg === "hacker");     // binario verde solo con ese fondo

            S.best = prog.loadBest();
            S.bestWords = prog.loadBestWords();
            eco.applyExtras();   // acento de color de los extras activos

            // Textos según el estado actual de la partida
            if (S.state === "idle") {
                S.statusTxt = t("statusIdle");
                S.startTxt = t("btnStart");
            } else if (S.state === "over") {
                S.statusTxt = t("statusEnd");
                S.startTxt = t("btnAgain");
            }

            events.apply();   // temática del evento en curso (clase, variante, cuenta atrás)
        }

    setLang(next) {
            if (S.lang === next || S.state === "playing") return;
            S.lang = next;
            this.applyLang();
        }

    setMode(next) {
            if (S.mode === next || S.state === "playing") return;
            S.mode = next;
            this.applyLang();
        }

    setBg(next) {
            // La habilidad del fondo no se puede cambiar a mitad de partida
            if (S.state === "playing" || S.bg === next || !S.ownedBgs.includes(next)) return;
            S.bg = next;
            try {
                storage.set("teclear.fondo", S.bg);
            } catch (e) { /* sin almacenamiento disponible */ }
            this.applyLang();
        }

    applyVeyon() {
            document.body.classList.toggle("veyon-on", S.veyon);
            // Icono de la ventana (pestaña): con el modo activo deja de
            // verse el de estesoTeclea y se pone el de repuesto
            document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
                .forEach(l => { l.href = S.veyon ? VEYON_FAVICON : imgLogo; });
        }

    setVeyon(next) {
            S.veyon = !!next;
            setSetting("veyon", S.veyon);
            this.applyVeyon();
        }

    level() {
            // Los modos con dificultad propia la calculan ellos
            // (Aventura acelera con las palabras, Supervivencia con el reloj)
            const lv = modes[S.mode].level();
            if (lv != null) return lv;
            return 1 + Math.floor(S.completed / 5);
        }

    tickSpeed() {
            // En Aventura el reloj acelera con el nivel (el modo lo calcula);
            // en el resto siempre va a velocidad normal
            return modes[S.mode].tickSpeed();
        }

    wordPool() {
            // Palabras que aportan los extras con lista propia (php, andaluz, cubico)
            const propias = [];
            if (eco.extraActive("php")) propias.push(PHP_WORDS);
            if (eco.extraActive("andaluz")) propias.push(ANDALUZ_WORDS);
            if (eco.extraActive("cubico")) propias.push(MINECRAFT_WORDS);
            // Modo Truco o trato (evento de Halloween): palabras terroríficas
            if (eco.extraActive("truco")) {
                propias.push(S.lang === "en" ? HALLOWEEN_WORDS.en : HALLOWEEN_WORDS.es);
            }

            let pool;
            if (eco.extraActive("caos")) {
                // Caos: todo mezclado, listas propias incluidas
                pool = WORDS.es.concat(WORDS.en, MURCIANO_WORDS);
                if (eco.extraActive("picante")) pool = pool.concat(PICANTE.es, PICANTE.en);
                propias.forEach(l => { pool = pool.concat(l); });
                return pool;
            }
            const base = S.lang === "mur" ? MURCIANO_WORDS : WORDS[S.lang];
            // Si hay alguna lista propia, la partida se juega con ella (y con
            // el idioma, para dar variedad), salvo que solo esté la lista propia
            if (propias.length) {
                // Si el Al azar sortea dos modos con lista propia, se juega con las dos
                pool = [];
                propias.forEach(l => { pool = pool.concat(l); });
                // Se añade algo del idioma para no repetir siempre lo mismo
                for (let i = 0; i < Math.min(10, base.length); i++) {
                    if (Math.random() < 0.35) pool.push(base[i]);
                }
                return pool;
            }
            if (!eco.extraActive("picante")) return base;
            const spicy = S.lang === "mur" ? PICANTE.es : PICANTE[S.lang];
            return Math.random() < 0.5 ? spicy : base;
        }

    mirrorWord(w) {
            return w.split("").reverse().join("");
        }

    rollRandomExtras() {
            const candidatos = eco.all("extra").filter(x => x.id !== "azar" && eco.ownsExtra(x.id));
            this.extraRun = { azar: true };
            if (candidatos.length === 0) return [];
            // Un tercio de las veces, dos extras a la vez
            const dobles = candidatos.length > 1 && Math.random() < 0.34;
            const elegidos = [];
            const copia = candidatos.slice();
            const n = dobles ? 2 : 1;
            for (let k = 0; k < n && copia.length; k++) {
                const i = Math.floor(Math.random() * copia.length);
                elegidos.push(copia[i].id);
                this.extraRun[copia[i].id] = true;
                copia.splice(i, 1);
            }
            return elegidos;
        }

    nextWord() {
            // El modo puede traer su propia palabra (Imágenes elige una
            // imagen y pide la palabra que la nombra)
            const picked = modes[S.mode].pickWord();
            if (picked) return picked;
            const list = this.wordPool();
            const lvl = this.level();
            let pool;
            // Modo Turbo del fondo Circuito: mientras dura, palabras MUY
            // cortas (manda sobre el filtro del modo y el nivel)
            if (abilities.turboOn()) {
                pool = list.filter(w => w.length <= TURBO_MAX);
            } else {
            // El modo puede imponer su filtro (ventaja "camino corto" de
            // Aventura: palabras cortas mientras dure)
            const filtered = modes[S.mode].filterPool(list);
            if (filtered) pool = filtered;
            else if (lvl <= 1) pool = list.filter(w => w.length <= 5);
            else if (lvl <= 3) pool = list.filter(w => w.length <= 7);
            else if (lvl <= 6) pool = list.filter(w => w.length >= 5);
            else pool = list.filter(w => w.length >= 6);
            }

            if (pool.length === 0) pool = list;

            let w;
            do {
                w = pool[Math.floor(Math.random() * pool.length)];
            } while (w === S.word && pool.length > 1);
            // Modo Espejo: la palabra se pide del revés
            return eco.extraActive("espejo") ? this.mirrorWord(w) : w;
        }

    multiplier() {
            // El modo puede pisar el multiplicador (ventaja "racha
            // dorada" de Aventura: clavado en x5 mientras dure)
            const base = Math.min(1 + Math.floor(S.streak / 4), 5);
            return modes[S.mode].multiplier(base);
        }

    gameTime() {
            return GAME_TIME + (eco.bgPower("elprico") ? BONUS_TIME_ELPRICO : 0);
        }

    soupGiven() {
            if (!eco.bgPower("sopa")) return 0;
            return Math.min(SOUP_GIVEN, Math.max(0, S.word.length - 1));
        }

    soupReveal() {
            const give = this.soupGiven();
            if (!give) return;
            const hidden = [];
            for (let i = 0; i < S.mask.length; i++) {
                if (S.mask[i] === "hidden") hidden.push(i);
            }
            // Se deja siempre alguna letra por descubrir: si no, la palabra
            // no podría completarse nunca en el modo adivinar
            const max = Math.min(give, hidden.length - 1);
            for (let k = 0; k < max; k++) S.mask[hidden[k]] = "found";
        }

    soupPrefill() {
            const give = this.soupGiven();
            if (!give) return;
            this.typing.value = S.word.slice(0, give);
            S.typedStr = this.typing.value;
            S.prevLen = give;   // ya tecleadas: no suman golpes ni fallos
        }

    updateHud() {
            // (todo el HUD lo pinta Svelte leyendo G; el pulso repinta el
            // campo de Supervivencia, cuyas cajas se mueven a cada tick)
            S.supTick++;
            // Logro «Hacker»: se anota la mejor puntuación de UNA partida.
            // Este es el sitio donde se refleja el marcador de todos los
            // modos, así que aquí se comprueba la meta de 10.000 puntos.
            prog.achBest("hacker", S.score);
        }

    newWord() {
            this.typing.value = "";
            S.typedStr = "";
            S.prevLen = 0;
            S.word = this.nextWord();
            // El modo prepara su tablero (Adivinar monta la máscara,
            // Supervivencia suelta la primera palabra apuntada)
            modes[S.mode].onNewWord();
            if (S.mode === "type" || S.mode === "aventura") {
                this.soupPrefill();   // letras que deja Sopa de Letras
            }
            this.updateHud();
        }

    pagaPalabra() {
            S.completed++;
            S.streak++;
            // Logros: se anota la palabra recién escrita, ANTES de que
            // newWord() la cambie por la siguiente. El reto "Un poco de
            // pólvora" cuenta los «creeper» tecleados en el modo Tecleo
            // con el Modo Cúbico activo (también si sale del revés).
            if (S.mode === "type" && eco.extraActive("cubico")) {
                const w = S.word.toLowerCase();
                if (w === "creeper" || w === this.mirrorWord("creeper")) prog.achAdd("polvo", 1);
            }
            // Logro «Speedrunner»: las palabras se cuentan dentro de una
            // misma ventana de 8 segundos. Si la ventana se pasa de largo
            // empieza otra nueva y el mejor intento queda anotado.
            const ahoraSR = Date.now();
            if (!this.srAt || ahoraSR - this.srAt > SPEEDRUN_MS) {
                this.srAt = ahoraSR;
                this.srWords = 0;
            }
            this.srWords++;
            prog.achBest("speed", this.srWords);
            const mult = this.multiplier();
            // Habilidades del fondo: Ia triplica puntos y monedas en las
            // palabras largas (más de 7 letras) y General dobla las monedas
            const largo = S.word.length > 7;
            const triple = eco.bgPower("esteso") && largo;
            // Multiplicadores propios del modo (ventana de "puntos x2")
            const points = S.word.length * 10 * mult * (triple ? SCORE_BOOST : 1) * modes[S.mode].scoreMult();
            S.score += points;
            fx.showPoints(points);
            // Monedas al estilo experiencia: la racha multiplica lo que ganas.
            // Cada palabra sin errores paga 1 moneda por cada nivel de racha
            // (x1 al principio y hasta x5 con la racha larga).
            const coinGain = mult *
                (triple ? SCORE_BOOST : 1) *
                (eco.bgPower("franco") ? 2 : 1) *
                // Multiplicador propio del modo (ventana de "monedas dobles")
                modes[S.mode].coinMult() *
                // Modo Truco o trato (evento de Halloween): DOBLE de monedas
                (eco.extraActive("truco") ? 2 : 1);
            eco.giveCoins(coinGain);
            fx.showCoin(coinGain);
            // Recompensa propia del modo (Supervivencia: XP en caliente;
            // Aventura: segundos al cronómetro)
            modes[S.mode].onReward(points);
            // Fondo Hacker: habilidad pasiva, cada palabra escrita regala
            // un segundo al cronómetro (en Supervivencia el reloj es el de
            // la palabra, así que ahí no suma)
            if (abilities.hackerOn() && S.mode !== "supervivencia") {
                S.timeLeft += 1;
                fx.float("+1s", "time");
            }
        }

    completeWord() {
            this.pagaPalabra();
            this.newWord();
            // El modo reacciona a la palabra completada (Aventura: cada
            // ciertas palabras hay una parada para elegir una ventaja)
            modes[S.mode].onWordComplete();
        }

    startGame() {
            if (S.state === "playing") return;

            S.state = "playing";
            S.score = 0;
            S.streak = 0;
            S.hits = 0;
            S.errors = 0;
            S.completed = 0;
            S.prevLen = 0;
            S.misses = 0;
            S.wrongLetters = [];
            this.ttXpLoss = 0;   // experiencia robada por fallos (Truco o trato)
            S.candyRun = 0;   // caramelos ganados en esta partida
            // Habilidades de los fondos: cada partida empieza con la suya
            // lista —Turbo y Chica Rush solo valen UNA vez por partida—
            abilities.reset();
            // Cada modo arranca su parte (vidas, tablero, clase del body…)
            modes[S.mode].enter();
            // El modo Aventura se juega contra un cronómetro propio: 50 s
            // En Supervivencia el reloj es el de la palabra apuntada
            S.timeLeft = modes[S.mode].timerStart() ?? this.gameTime();
            S.coinsRun = 0;
            // Telemetría anti-automatización: se reinicia en cada partida
            acc.keyStamps = [];
            acc.inputEvents = 0;
            acc.trustedInput = 0;
            acc.trustedKeys = 0;
            acc.pasteTried = 0;
            this.gameStartAt = Date.now();
            this.gameDuration = 0;
            // Cada partida empieza con la ventana del logro Speedrunner vacía
            this.srAt = 0;
            this.srWords = 0;

            if (S.shopOpen) { // la tienda se cierra al empezar
                S.shopOpen = false;
            }
            this.closeLogrosOnPlay();   // el panel de logros también
            this.closeInvOnPlay();      // el panel de inventario también
            acc.closeAccountOnPlay();   // el panel de perfil también

            S.resOpen = false;
            S.startTxt = t("btnRestart");

            // Modo Al azar: se sortean los extras de ESTA partida y se
            // muestran en el tablero antes de que salga la primera palabra
            let azarTxt = "";
            if (eco.extraActive("azar")) {
                const elegidos = this.rollRandomExtras();
                eco.applyExtras();   // el tablero se ilumina con los modos elegidos
                if (elegidos.length === 0) {
                    azarTxt = t("statusAzarNone");
                } else {
                    const nombres = elegidos.map(id => {
                        const x = eco.all("extra").find(e => e.id === id);
                        return x ? x.icon + " " + (uiLang() === "es" ? x.es : x.en) : id;
                    });
                    azarTxt = t("statusAzar") + nombres.join(" + ");
                }
            }

            this.typing.value = "";
            S.typedStr = "";
            this.typing.focus();
            S.statusTxt =
                S.mode === "imagen" ? t("statusPlayI") :
                S.mode === "guess" ? t("statusPlayG") :
                S.mode === "aventura" ? t("statusPlayA") :
                S.mode === "supervivencia" ? t("statusPlayS") :
                (S.lang === "mur" && S.mode === "type") ? t("statusPlayM") : t("statusPlay");
            if (azarTxt) S.statusTxt = azarTxt;
            // Modo Truco o trato (evento de Halloween): se avisan sus reglas
            // (doble de monedas, pero doble castigo por tecla fallada)
            if (eco.extraActive("truco")) S.statusTxt = t("statusTruco");
            // Aviso de la habilidad que aporta el fondo equipado
            // (en Aventura no actúa ningún fondo: el modo lleva el suyo)
            const poder = eco.bgPowerDesc();
            if (poder && S.mode !== "aventura") {
                S.statusTxt += " · " + poder;
            }
            // Modo Encantado (evento): sus reglas mandan sobre los avisos previos
            if (this.encOn()) S.statusTxt = t("encStart");
            this.lastTick = performance.now();

            this.newWord();
            this.updateHud();

            clearInterval(this.timerId);
            this.timerId = setInterval(this.tick.bind(this), 100);
        }

    tick() {
            const now = performance.now();
            // Modo Aventura: mientras se elige ventaja el reloj no corre
            if (S.perkOpen) {
                this.lastTick = now;
                return;
            }
            // El Turbo del fondo Circuito se apaga solo al pasar sus 10 s
            if (S.turboUntil && now >= S.turboUntil) abilities.turboStop();
            // Las habilidades Turbo y Chica Rush congelan el reloj mientras
            // duran (en Supervivencia eso congela también las palabras)
            if (abilities.frozen(now)) {
                this.lastTick = now;
                this.updateHud();
                return;
            }
            // Los modos con pulso propio se ocupan solos (Supervivencia
            // mueve su campo, Aventura su congelación y su salvavidas)
            const dt = now - this.lastTick;
            if (modes[S.mode].tick(now, dt)) {
                this.lastTick = now;
                return;
            }
            // El tiempo que queda se consume a la velocidad del modo
            // (Aventura acelera con el nivel; el resto, velocidad normal)
            S.timeLeft -= dt / 1000 * this.tickSpeed();
            this.lastTick = now;

            if (S.timeLeft <= 0) {
                S.timeLeft = 0;
                this.updateHud();
                this.endGame();
                return;
            }
            this.updateHud();
        }

    endGame() {
            clearInterval(this.timerId);
            // Duración real de la partida: si alguien congeló el cronómetro
            // para alargarla y sumar puntos, esto lo delata. Las paradas del
            // modo Aventura (elegir ventaja) no se cuentan como tiempo jugado.
            this.gameDuration = this.gameStartAt > 0
                ? Math.max(0, (Date.now() - this.gameStartAt - modes[S.mode].pausedMs()) / 1000)
                : this.gameTime();
            S.state = "over";
            // Cada modo retira lo suyo (el tablero de Supervivencia, la
            // pantalla grande, las ventanas de ventajas…)
            modes[S.mode].exit();
            // Si se acaba la partida con una habilidad encendida, se corta
            abilities.stopAll();
            // Modo Al azar: al acabar se olvida lo sorteado en esta partida
            if (this.extraRun) {
                this.extraRun = null;
                eco.applyExtras();
            }
            S.startTxt = t("btnAgain");

            const total = S.hits + S.errors;
            const accPct = total === 0 ? 100 : Math.round((S.hits / total) * 100);
            // Los ppm se calculan sobre lo que duró de verdad la partida
            // (Aventura y Supervivencia no tienen duración fija: usan la real)
            const fija = S.mode === "aventura" || S.mode === "supervivencia";
            const dur = (fija && this.gameDuration > 0) ? this.gameDuration : this.gameTime();
            const ppm = S.completed / (dur / 60);

            const newScoreRecord = S.score > S.best;
            const newWordsRecord = S.completed > S.bestWords;

            if (newScoreRecord) {
                S.best = S.score;
                prog.saveBest();
            }
            if (newWordsRecord) {
                S.bestWords = S.completed;
                prog.saveBestWords();
            }

            let msg;
            if (newScoreRecord && newWordsRecord) {
                msg = t("msgRecordBoth");
            } else if (newScoreRecord) {
                msg = t("msgRecord");
            } else if (newWordsRecord) {
                msg = t("msgWordsRecord");
            } else if (accPct >= 95) {
                msg = t("msgAcc");
            } else if (S.completed >= 20) {
                msg = t("msgRhythm");
            } else {
                msg = t("msgRetry");
            }

            // Experiencia ganada en esta partida y totales del perfil:
            // se suman aquí porque es cuando se da por terminada la partida.
            // El modo Truco o trato descuenta la experiencia que las teclas
            // falladas se han ido tragando durante la partida (ttXpLoss)
            // El modo Encantado no da NI experiencia NI monedas: su partida
            // se cobra solo en caramelos (dar 0 XP lo garantiza aquí mismo)
            const xpGain = this.encOn() ? 0 : Math.max(0,
                S.completed * 10 + Math.floor(S.score / 10) - this.ttXpLoss);
            S.xp += xpGain;
            S.gamesPlayed += 1;
            S.wordsTotal += S.completed;
            prog.saveProfileStats();

            // Guardado automático del perfil en cada partida terminada
            acc.saveProfile();

            // Formulario para apuntar la puntuación en el ranking global
            this.savedScore = false;
            S.rankBusy = false;
            S.rankMsgTxt = "";
            S.rankMsgOff = false;
            if (S.score > 0) acc.newVerifyCode();   // código nuevo para cada puntuación
            // Sin cuenta no hay nombre que escribir: se pide crear un perfil
            if (S.accOpen) acc.closeAccount();   // los resultados se ven sin el panel encima

            // Todo el panel de resultados lo lee Svelte desde este resumen
            S.res = {
                score: S.score,
                words: S.completed,
                acc: accPct,
                ppm: Math.round(ppm),
                coins: S.coinsRun,
                // Los caramelos solo se enseñan mientras dura el evento
                candy: S.candyRun,
                xp: xpGain,
                best: S.bestWords,
                msg: msg,
                record: newScoreRecord || newWordsRecord
            };
            S.statusTxt = t("statusEnd");
            this.typing.blur();
            S.resOpen = true;
        }

    typeInput() {
            let val = this.typing.value.toLowerCase();
            if (this.typing.value !== val) this.typing.value = val;

            if (val.length > S.word.length) {
                val = val.slice(0, S.word.length);
                this.typing.value = val;
            }

            // Detecta la primera tecla mal escrita: la rechaza y penaliza
            let bad = -1;
            for (let i = 0; i < val.length; i++) {
                if (val[i] !== S.word[i]) {
                    bad = i;
                    break;
                }
            }

            if (bad !== -1) {
                val = val.slice(0, bad);
                this.typing.value = val;
                // El modo puede absorber el fallo (escudo de Aventura) o
                // dejarlo pasar sin romper la racha (indulgencia)
                const absorbed = modes[S.mode].onBadKey();
                if (absorbed === "shield") {
                    S.statusTxt = t("statusShield");
                } else {
                    S.errors++;
                    if (absorbed !== "grace") S.streak = 0;
                    S.score = Math.max(0, S.score - 5);
                    fx.shake();
                    S.statusTxt = absorbed === "grace" ? t("statusGrace") : t("statusError");
                    // Modo Truco o trato (evento de Halloween): cada tecla
                    // fallada cuesta el DOBLE, en tiempo y en experiencia
                    if (eco.extraActive("truco")) {
                        S.timeLeft = Math.max(0, S.timeLeft - TT_TIME_PENALTY);
                        this.ttXpLoss += TT_XP_PENALTY;
                        S.statusTxt = t("statusTrucoFail");
                    }
                }
            } else {
                if (val.length > S.prevLen) S.hits += val.length - S.prevLen;
                S.statusTxt = t("statusOk");
            }

            S.prevLen = val.length;
            S.typedStr = val;
            this.updateHud();

            if (val === S.word) {
                this.completeWord();
            }
        }

    showLogoPhrase() {
            // Se descarta la anterior: nunca salen dos frases seguidas iguales
            let i = this.logoLast;
            while (i === this.logoLast) {
                i = Math.floor(Math.random() * LOGO_PHRASES.length);
            }
            this.logoLast = i;
            S.logoPhraseTxt = LOGO_PHRASES[i];
            S.logoShow = true;   // la clase «show» la pone Svelte al cambiar la frase

            clearTimeout(this.logoHide);
            this.logoHide = setTimeout(() => {
                S.logoShow = false;
            }, 2000);

            if (this.logoBtn) {
                this.logoBtn.classList.remove("pop");
                void this.logoBtn.offsetWidth;
                this.logoBtn.classList.add("pop");
            }
        }

    rankSay(txt, off) {
            S.rankMsgTxt = txt;
            S.rankMsgOff = !!off;
        }

    saveScore() {
            if (S.state === "playing" || S.rankBusy) return;
            if (this.savedScore) {
                this.rankSay(t("rankAlready"));
                return;
            }
            if (S.score <= 0) return;

            // 1) Sin perfil no hay nombre: se avisa y se abre el registro
            if (!S.accSession) {
                this.rankSay(t("accRankNo"), true);
                acc.openAccount("reg");
                if (this.accName) { this.accName.focus(); this.accName.select(); }
                return;
            }
            const name = S.accSession.n;

            // 2) Nada de escritura automática ni puntuaciones imposibles
            const why = acc.checkAutoPlay();
            if (why.length > 0) {
                this.rankSay(t("rankBot"), true);
                return;
            }

            // 3) Comprobación humana: el código se teclea con las teclas reales
            if (!acc.verifyHuman()) {
                this.rankSay(t("rankHuman"), true);
                acc.newVerifyCode();       // código nuevo: no se puede probar a ciegas
                if (this.verifyInput) this.verifyInput.focus();
                return;
            }

            const entry = {
                id: identity.currentPlayerId(),   // la cuenta (o el dispositivo) ocupa un puesto
                n: name,
                s: S.score,             // la mejor marca es la que manda
                w: S.completed,
                m: ranking.entryMode(),
                d: new Date().toISOString()
            };

            S.rankBusy = true;
            this.rankSay(t("rankChecking"));

            acc.reserveName(name, entry.id).then(r => {
                if (r.taken) {
                    // El nombre ya es de otro jugador: se avisa sin borrar nada
                    S.rankBusy = false;
                    this.rankSay(t("rankNameTaken"), true);
                    acc.newVerifyCode();
                    return;
                }
                identity.savePlayerName(name);
                this.rankSay(t("rankSaving"));
                return ranking.uploadScore(entry).then(() => {
                    S.rankBusy = false;
                    // Solo se da por SUBIDA si la marca ha llegado al servidor.
                    // Si la red falló, la puntuación queda en este equipo y el
                    // botón sigue habilitado para volver a intentarlo (antes se
                    // marcaba como guardada y el segundo intento se quedaba en
                    // «ya habías guardado», así que NUNCA se podía subir).
                    const subida = ranking.rankData[ranking.rankTabOf(entry.m)].online;
                    this.savedScore = subida;
                    this.rankSay(subida ? t("rankSaved") : t("rankSavedLocal"), !subida);
                    acc.newVerifyCode();   // el código ya no se puede reutilizar
                    // Se abre el ranking de SU modo (Aventura va al suyo propio)
                    if (!S.rankOpen) this.toggleRanking(ranking.rankTabOf(entry.m));
                });
            }).catch(() => {
                S.rankBusy = false;
                this.savedScore = false;   // nada llegó al servidor: se puede reintentar
                this.rankSay(t("rankSavedLocal"), true);
                acc.newVerifyCode();
            });
        }

    // ---------- Depuración (solo administradores) ----------
    // Pone un campo de S a un valor. Los campos con efectos secundarios
    // (fondo, fuente, efecto, extra, veyon, modo) pasan por sus setters
    // normales para no dejar la UI a medias; el resto se escribe directo.
    dbgSet(key, val) {
            if (!acc.esAdmin()) return;
            // «extra.<id>» activa o apaga un extra concreto del menú
            if (key.startsWith("extra.")) {
                const id = key.slice(6);
                if (!S.ownedExtras.includes(id)) S.ownedExtras.push(id);
                eco.setExtra(id, !!val);
                return;
            }
            switch (key) {
                case "bg":
                    // Deja constancia del fondo aunque no lo tuviéramos
                    if (!S.ownedBgs.includes(val)) S.ownedBgs.push(val);
                    this.setBg(val);
                    return;
                case "equipped":
                    if (!S.owned.includes(val)) S.owned.push(val);
                    eco.setEquipped(val);
                    return;
                case "fxEquipped":
                    if (val && !S.ownedFx.includes(val)) S.ownedFx.push(val);
                    eco.setFx(val);
                    return;
                case "veyon":
                    this.setVeyon(!!val);
                    return;
                case "mode":
                    this.setMode(val);
                    return;
                case "state":
                    if (val === "playing" && S.state !== "playing") this.startGame();
                    else if (S.state === "playing") this.endGame();
                    return;
                default:
                    S[key] = val;
            }
        }

    // Suma (o resta) un número a un campo numérico de S
    dbgAdd(key, n) {
            if (!acc.esAdmin()) return;
            S[key] = (S[key] || 0) + n;
            if (key === "caramelos") eco.saveCandy();
        }

    // Concede TODOS los artículos del catálogo — la forma explícita de
    // "quiero probarlo todo" que sustituye al antiguo dinero infinito
    dbgGrantAll() {
            if (!acc.esAdmin()) return;
            eco.all("font").forEach(s => { if (!S.owned.includes(s.id)) S.owned.push(s.id); });
            eco.all("bg").forEach(b => { if (!S.ownedBgs.includes(b.id)) S.ownedBgs.push(b.id); });
            eco.all("extra").forEach(x => { if (!S.ownedExtras.includes(x.id)) S.ownedExtras.push(x.id); });
            eco.all("fx").forEach(f => { if (!S.ownedFx.includes(f.id)) S.ownedFx.push(f.id); });
            eco.saveShop();
            eco.applyExtras();
        }

    // Cartera de admin: saldo suficiente para comprar TODO lo que se
    // vende — monedas = suma de precios normales, caramelos = suma de
    // precios de evento. Así se prueba el camino real de la tienda
    // (buyItem → cobra → mensajes) en vez de regalar los artículos
    dbgFunds() {
            if (!acc.esAdmin()) return;
            let monedas = 0, caramelos = 0;
            for (const kind of ["font", "bg", "extra", "fx"]) {
                eco.all(kind).forEach(it => {
                    if (it.price == null) return;    // los de logro no se venden
                    if (it.event) caramelos += it.price;
                    else monedas += it.price;
                });
            }
            // Sube al total necesario; nunca baja el saldo que ya tengas
            S.coins = Math.max(S.coins, monedas);
            S.caramelos = Math.max(S.caramelos, caramelos);
            eco.saveShop();
            eco.saveCandy();
            S.shopMsgTxt = "🐞 Fondos de prueba: " + monedas + "🪙 · " + caramelos + "🍬";
        }

    // Compra TODO por el camino real — cada artículo con precio pasa por
    // buyItem (cobra, mensaje, persistencia). Los artículos de logro no
    // se pueden comprar: esos se conceden como en dbgGrantAll
    dbgBuyAll() {
            if (!acc.esAdmin()) return;
            this.dbgFunds();
            for (const kind of ["font", "bg", "extra", "fx"]) {
                eco.all(kind).forEach(it => {
                    if (it.price == null) return;
                    eco.buyItem(kind, it);
                });
            }
            this.dbgGrantAll();   // cubre los artículos de logro
        }

    // ---------- Acciones para la vista (engine.actions.x) ----------
    actions = {
            setLang: this.setLang.bind(this),
            setMode: this.setMode.bind(this),
            setBg: this.setBg.bind(this),
            chooseExtra: id => eco.chooseExtra(id),
            setSupVariant: this.setSupVariant.bind(this),
            toggleVeyon: () => this.setVeyon(!S.veyon),
            toggleShop: this.toggleShop.bind(this),
            toggleInv: this.toggleInv.bind(this),
            toggleLogros: this.toggleLogros.bind(this),
            toggleRanking: () => this.toggleRanking(),
            toggleAccount: m => acc.toggleAccount(m),
            closeAccount: () => acc.closeAccount(),
            submitAccount: () => acc.submitAccount(),
            accSwitchMode: () => acc.accSwitchMode(),
            accSave: () => acc.accSaveProfile(),
            accOut: () => acc.doLogout(),
            buyItem: (kind, id) => eco.buyItem(kind, eco.findItem(kind, id)),
            startGame: this.startGame.bind(this),
            saveScore: this.saveScore.bind(this),
            useAbility: () => abilities.useAbility(),
            bindAbilityKey: () => { S.bindingKey = !S.bindingKey; },
            choosePerk: p => modes.aventura.choosePerk(p),
            supAim: n => {
                modes.supervivencia.aimByN(n);
                if (this.typing) this.typing.focus();
            },
            verifyKey: e => acc.verifyKey(e),
            verifyInput: e => acc.verifyInputText(e),
            verifyPaste: e => acc.verifyPaste(e),
            picError: () => { S.picErr = true; },
            showLogoPhrase: this.showLogoPhrase.bind(this),
            // Depuración de administradores (panel visual, todo filtrado
            // por esAdmin dentro de cada operación)
            dbgToggle: () => { if (acc.esAdmin()) S.debugOpen = !S.debugOpen; },
            dbgSet: this.dbgSet.bind(this),
            dbgAdd: this.dbgAdd.bind(this),
            dbgGrantAll: () => { if (acc.esAdmin()) this.dbgGrantAll(); },
            dbgFunds: () => { if (acc.esAdmin()) this.dbgFunds(); },
            dbgBuyAll: () => { if (acc.esAdmin()) this.dbgBuyAll(); },
            dbgEvent: id => { if (!acc.esAdmin()) return; id ? events.test(id) : events.clearTest(); },
        };

    // ---------- Montaje: elementos, servicios, listeners e init ----------
    mount() {
this.stage = document.getElementById("stage");
this.board = document.getElementById("board");
this.typing = document.getElementById("typing");
this.logros = document.getElementById("logros");
this.inventario = document.getElementById("inventario");
this.perfil = document.getElementById("perfil");
this.accName = document.getElementById("accName");
this.accPass = document.getElementById("accPass");
this.accPass2 = document.getElementById("accPass2");
this.rankingEl = document.getElementById("ranking");
this.verifyInput = document.getElementById("verifyInput");
        fx.bind({
            stage: this.stage, board: this.board, typing: this.typing,
            getSupTarget: () => modes.supervivencia.target,
            getActiveFx: () => eco.activeFx(),
        });
        fx.mount();
        // Habilidades de los fondos: sus capas fijas y la escucha de la
        // reasignación de la tecla reservada
        abilities.bind({ typing: this.typing });
        abilities.mount();
        eco.bind({
            isAdmin: () => acc.esAdmin(),
            achAdd: (id, n) => prog.achAdd(id, n),
            getExtraRun: () => this.extraRun,
            resetExtraRun: () => { this.extraRun = null; },
            applyLang: this.applyLang.bind(this),
        });
        acc.bind({
            perfil: this.perfil, accName: this.accName, accPass: this.accPass, accPass2: this.accPass2, verifyInput: this.verifyInput,
            applyLang: this.applyLang.bind(this),
            saveScore: this.saveScore.bind(this),
            getHits: () => S.hits,
            getGameDuration: () => this.gameDuration,
            getAdvTimeGained: () => modes.aventura.timeGained,
        });
        // El servicio de eventos solo necesita saber quién es admin
        // (las pruebas de eventos fuera de fecha son exclusivas suyas)
        events.bind({ isAdmin: () => acc.esAdmin() });
        events.loadTest();

        Object.values(modes).forEach(m => { m.engine = this; });
        this.typing.addEventListener("input", (e) => {
            // Chica Rush: mientras dura no se puede escribir
            if (S.state !== "playing" || S.perkOpen || abilities.chicaOn()) {
                this.typing.value = "";
                return;
            }
            acc.inputEvents++;
            if (e && e.isTrusted) acc.trustedInput++;

            // Cada modo procesa la entrada a su manera (Adivinar letra
            // a letra, Supervivencia contra la palabra apuntada…)
            modes[S.mode].input();
        });
        this.typing.addEventListener("keydown", (e) => {
            if (S.state !== "playing") return;
            // Chica Rush: mientras dura no se teclea ni una letra
            if (abilities.chicaOn()) {
                e.preventDefault();
                return;
            }
            if (e.isTrusted) acc.trustedKeys++;
            if (!e.repeat) acc.keyStamps.push(performance.now()); // el auto-repetido no cuenta
            // Efecto de tecleo comprado en la tienda: estalla con cada letra
            if (!e.repeat && !S.perkOpen && e.key && e.key.length === 1 && !/\s/.test(e.key)) {
                fx.fxBurst();
            }
            // Teclas propias del modo (Supervivencia: Tab cambia el
            // objetivo a la siguiente palabra sin salir del campo)
            modes[S.mode].keydown(e);
        });
        this.typing.addEventListener("paste", (e) => {
            if (S.state !== "playing") return;
            e.preventDefault();
            acc.pasteTried++;
            S.statusTxt = t("statusNoPaste");
        });
        this.typing.addEventListener("drop", (e) => {
            if (S.state !== "playing") return;
            e.preventDefault();
            acc.pasteTried++;
        });
        document.addEventListener("keydown", (e) => {
            const destino = e.target || {};
            // Si el foco está en un campo de texto (el nombre del ranking, por
            // ejemplo) la barra escribe un espacio y NO arranca la partida
            const enCampo = !destino.disabled &&
                (destino.tagName === "INPUT" || destino.tagName === "TEXTAREA" ||
                 destino.tagName === "SELECT" || destino.isContentEditable === true);

            // Tecla reservada de la habilidad del fondo (fila «Controles»):
            // solo se intercepta si hay habilidad DISPONIBLE, así que con
            // otro fondo —o mientras corre— la tecla sigue siendo una tecla
            // normal. Si ya se gastó, se avisa sin comerse la tecla.
            if (S.state === "playing" && !e.repeat && e.code === S.abilityKey && abilities.abilityId()) {
                if (abilities.abilityReady()) {
                    e.preventDefault();
                    abilities.useAbility();
                    return;
                }
                if (!abilities.frozen()) S.statusTxt = t("stAbUsed");
            }
            if (S.state === "playing") {
                // En plena partida la barra nunca se introduce: las palabras no llevan espacios
                if (e.code === "Space") e.preventDefault();
                return;
            }
            if (e.code === "Space" && !enCampo && destino.tagName !== "BUTTON") {
                e.preventDefault();
                this.startGame();
            }
        });
this.logoBtn = document.getElementById("logoBtn");
        eco.loadShop();
        eco.loadCandy();
        try {
            const sv = storage.get("teclear.supVariante");
            if (sv === "encantado" || sv === "clasico") S.supVariant = sv;
        } catch (e) { /* sin almacenamiento disponible */ }
        // Si la variante guardada pertenece a un evento que no está activo,
        // se vuelve al clásico (p. ej. Encantado fuera de Halloween)
        if (S.supVariant !== "clasico" && S.supVariant !== events.active?.supVariant) {
            S.supVariant = "clasico";
        }
        S.accSession = acc.loadSession();
        prog.achLoad();
        prog.loadProfileStats();
        // El Administrador con SU sesión abierta lo tiene todo hecho:
        // puede probar las recompensas de los logros sin ganarlas
        if (acc.esAdminSesion()) prog.grantAllAch();
        try {
            const savedBg = storage.get("teclear.fondo");
            if (savedBg && eco.all("bg").some(b => b.id === savedBg) && S.ownedBgs.includes(savedBg)) {
                S.bg = savedBg;
            }
        } catch (e) {
            S.bg = "dark";
        }
        this.applyVeyon();
        eco.applyStyle();
        eco.applyFx();
        this.applyLang();
        if (this.accName) this.accName.value = identity.loadPlayerName();
        ranking.refreshRanking();
        Object.defineProperty(window, "Teclea", {
            value: Object.freeze({
                get state() { return S.state; },
                get score() { return S.score; },
                get completed() { return S.completed; },
                get hits() { return S.hits; },
                get errors() { return S.errors; },
                get word() { return S.word; },
                get mode() { return ranking.entryMode(); },
                get lang() { return S.lang; },
                get savedScore() { return engine.savedScore; },
                get rankResets() { return ranking.rankResets; },
                get session() { return S.accSession; },
                get admin() { return acc.esAdmin(); },   // ¿rol de Administrador?
                get caramelos() { return S.caramelos; },   // moneda del evento de Halloween
                get supVariante() { return S.supVariant; },   // variante de Supervivencia
                get xp() { return S.xp; },
                get lives() { return S.supLives; },   // vidas en el modo Supervivencia
                get gamesPlayed() { return S.gamesPlayed; },
                get wordsTotal() { return S.wordsTotal; },
                // Diccionarios (solo lectura): útiles para comprobar las palabras
                dicts: Object.freeze({
                    es: Object.freeze(WORDS.es.slice()),
                    en: Object.freeze(WORDS.en.slice()),
                    mur: Object.freeze(MURCIANO_WORDS.slice())
                }),
                start: () => { this.startGame(); },
                finish: () => { this.endGame(); },
                // ¿Actúa la habilidad del fondo id? (en Aventura nunca actúa)
                fondoActivo: (id) => { return eco.bgPower(id); },
                checkAutoPlay: (est) => { return acc.checkAutoPlay(est); },
                normalizeRank: (lista, cortes, tab) => { return ranking.normalizeRank(lista, cortes, tab); },
                validEntry: (fila) => { return ranking.validEntry(fila); },
                sealOf: (fila) => { return ranking.sealOf(fila); },
                reserveName: (n, id) => { return acc.reserveName(n, id); },
                fetchResets: (force) => { return ranking.fetchResets(force); },
                refreshRanking: (tab) => { return ranking.refreshRanking(tab); },
                // Los dos rankings: a qué tabla pertenece una marca y sus filas
                rankTabDe: (m) => { return ranking.rankTabOf(m); },
                rankDe: (tab) => {
                    const t = (tab === "aventura") ? "aventura" : "normal";
                    return Object.freeze({
                        entries: Object.freeze(ranking.rankData[t].entries.slice()),
                        online: ranking.rankData[t].online,
                        loaded: ranking.rankData[t].loaded,
                        tampered: ranking.rankData[t].tampered
                    });
                },
                // Equilibrio de Aventura (solo lectura): velocidad del reloj y
                // palabras que faltan para la próxima parada de ventaja
                velocidadReloj: () => { return this.tickSpeed(); },
                proximaVentaja: () => { return modes.aventura.perkEvery(); },
                paradasHechas: () => { return modes.aventura.stops; },
                // Perfiles (solo lectura de fuera: registrar/entrar/salir)
                sha256: (s) => { return identity.sha256hex(String(s)); },
                derivePass: (p, s) => { return identity.derivePass(String(p), String(s)); },
                profileData: () => { return acc.snapshotData(); },
                loadProfiles: () => { return acc.loadProfilesLocal(); },
                register: (n, p, p2) => { return acc.doRegister(identity.cleanName(n), p, p2); },
                login: (n, p) => { return acc.doLogin(identity.cleanName(n), p); },
                logout: () => { return acc.doLogout(); },
                saveProfile: () => { return acc.saveProfile(); },
                openAccount: (m) => { acc.openAccount(m); },
                closeAccount: () => { acc.closeAccount(); },
                // Eventos (solo admin): fuerza un evento fuera de su fecha o
                // vuelve al calendario. Útil para probarlos en la página.
                get event() { return events.activeId(); },
                testEvent: (id) => { return events.test(id); },
                clearEvent: () => { events.clearTest(); }
            }),
            writable: false,
            configurable: false
        });
    }
}

export const engine = new GameEngine();
