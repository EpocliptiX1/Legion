const fs = require('fs');
const path = require('path');

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rand = seeded(Date.now());
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const shuffle = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const START_DATE = new Date('2022-01-01T00:00:00.000Z').getTime();
const END_DATE = new Date('2026-05-10T00:00:00.000Z').getTime();

function randomDateBetween(startMs, endMs) {
  return new Date(startMs + Math.floor(rand() * (endMs - startMs + 1)));
}

// --- GRAMMAR DEGRADATION ENGINE ---
// Makes the bots sound human by messing up their typing
function applyTypos(text) {
  let modified = text;
  
  // 80% chance to completely lowercase the sentence
  if (rand() < 0.80) modified = modified.toLowerCase();
  
  // 60% chance to remove trailing periods
  if (rand() < 0.60 && modified.endsWith('.')) modified = modified.slice(0, -1);
  
  // Random common typo replacements
  const typos = [
    { reg: /\bwhat\b/gi, rep: pick(['waht', 'wat', 'wht']) },
    { reg: /\bthat\b/gi, rep: pick(['tht', 'dat']) },
    { reg: /\byou\b/gi, rep: pick(['u', 'yo']) },
    { reg: /\bpeople\b/gi, rep: 'ppl' },
    { reg: /\breally\b/gi, rep: 'rly' },
    { reg: /\babout\b/gi, rep: 'abt' },
    { reg: /\bbecause\b/gi, rep: pick(['cuz', 'bc']) },
    { reg: /\bdefinitely\b/gi, rep: 'def' },
    { reg: /\bbrother\b/gi, rep: 'bro' },
    { reg: /\bfucking\b/gi, rep: pick(['fking', 'fckn', 'fkng']) },
    { reg: /\bshit\b/gi, rep: pick(['sh*t', 'ts', 'sht']) },
    { reg: /don't/gi, rep: 'dont' },
    { reg: /can't/gi, rep: 'cant' },
    { reg: /it's/gi, rep: 'its' },
    { reg: /i'm/gi, rep: 'im' }
  ];

  typos.forEach(t => {
    if (rand() < 0.3) modified = modified.replace(t.reg, t.rep); // 30% chance to apply a specific typo if it exists
  });

  return modified;
}

const normalHandleSeeds = [
  'void.syntax','neon_rival','static.bliss','sub_zero','cyber.specter','gloom_weaver','phantom_logic','obsidian_haze',
  'v_o_i_d','chroma_drift','digital_tomb','solstice_haz','neural_fade','echo_zone','silent_vector','shadow_drive',
  'abyssal_mind','parallel_void','tox_ic','night_shift_co','Vortex','Synapse','Sable','Zephyr','Rogue','Apex',
  'Fable','Cipher','Kodiak','Mirage','Echo','Prism','Vanguard','Glitch','Specter','Ronin','Rune','Grit','Novus',
  'Zenith','root_access','sudo_make','null_pointer','git_commit','compile_error','local_host','stack_overflow',
  'kernel_panic','ctrl_alt_defeat','code_drift','double_click','binary_star','syntax_error','buffer_overflow',
  'zero_day','hash_map','fork_bomb','daemon_process','bit_shift','localhost_8080','Cold_Frames','ZeroChill',
  'NoEffs','Lethal_Aim','Ping_Lord','AltF4_Champ','W-Keyer','No_Recoil','OneTap_Only','Carry_Me','Drop_Shock',
  'Unrated','Insta_Lock','Dead_Angle','Pixel_Perfect','Lobby_Wrecker','Bullet_Proof','Clutch_Gene','Whiplash',
  'Opps_Mad','velvet_afterglow','moondust_pages','cloudcore_vibes','faded_lilacs','paper_fern','silent_gale',
  'hush_life','midnight_index','solemn_stare','distant_echoes','cozy_ember','lost_but_learning','soft_grain_art',
  'midsommar_skies','slow_burn_life','pale_haze','whispering_void','bittersweet_vibe','faint_whispers','neutral_aura'
];

// --- MASSIVE LORE DICTIONARY ---
// Real facts for real titles so they actually discuss the plot
const animeData = [
  { 
    title: 'Re:ZERO', movieId: '81028', genre: 'Drama, Fantasy',
    lore: [
      "subaru rejecting rem after her whole speech was foul play",
      "the rabbit death scene actually traumatized me",
      "puck turning into that giant beast when emilia died was wild",
      "betelgeuse twisting his fingers makes me sick every time",
      "echidna's tea party is peak dialogue"
    ]
  },
  { 
    title: 'Attack on Titan', movieId: '37033', genre: 'Action, Dark Fantasy',
    lore: [
      "grisha manipulating the reiss family because future eren told him to is top tier writing",
      "the basement reveal changing the entire genre to a political war thriller is insane",
      "erwin charging the beast titan is the most hype speech in anime history",
      "the fact that the smiling titan was dina fritz all along... nah my jaw dropped",
      "gabi shooting sasha was so uncalled for im still mad"
    ]
  },
  { 
    title: 'Jujutsu Kaisen', movieId: '100482', genre: 'Action, Supernatural',
    lore: [
      "gojo getting sealed in the prison realm broke the whole power scaling",
      "sukuna disrespecting jogo after the fire arrow was brutal",
      "nanami deserved better man... the beach scene...",
      "toji pulling up to the dagon fight just to establish dominance",
      "mahito is the best pure hater villain we've had in years"
    ]
  },
  { 
    title: 'Demon Slayer', movieId: '88316', genre: 'Action, Historical Fantasy',
    lore: [
      "rengoku vs akaza animation was movie quality but that ending hurt",
      "uzui fighting poisoned with one hand is why he is the goat",
      "zenitsu finally fighting awake was the payoff we needed",
      "gyutaro and daki's backstory actually made me feel bad for them",
      "muzan dressing up as michael jackson in season 1 is still funny to me"
    ]
  },
  { 
    title: 'Steins;Gate', movieId: '60549', genre: 'Sci-Fi, Thriller',
    lore: [
      "okabe watching mayuri die 100 different ways broke me",
      "the gel-banana experiments were so creepy in hindsight",
      "suzuha's letter saying 'i failed i failed i failed' gives me chills",
      "the ep 23 plot twist where he has to trick his past self is genius",
      "kurisu is the only acceptable tsundere in anime"
    ]
  },
  {
    title: 'Hunter x Hunter', movieId: '46298', genre: 'Adventure, Action',
    lore: [
      "meruem playing gungi with komugi in his final moments was beautiful",
      "gon sacrificing his entire future just to beat pitou is dark af",
      "kurapika bringing a shovel to the uvogin fight is max disrespect",
      "hisoka dodging the dodgeball in greed island was crazy animation",
      "netero's rose bomb speech... human malice is truly bottomless"
    ]
  },
  {
    title: 'Death Note', movieId: '1535', genre: 'Psychological, Thriller',
    lore: [
      "L wiping light's feet before his death was crazy biblical symbolism",
      "naomi misora figuring it all out just to walk to a noose was a tragedy",
      "near is just a cheap copy of L idc what anyone says",
      "light eating a potato chip shouldn't be that dramatic but it is",
      "ryuk writing light's name at the end was the perfect poetic justice"
    ]
  },
  {
    title: 'Vinland Saga', movieId: '84042', genre: 'Historical, Drama',
    lore: [
      "askeladd is the best written antagonist, killing the king to save wales was a masterclass",
      "thorfinn dropping the dagger and saying 'i have no enemies' is pure character growth",
      "thors dying in episode 4 set the tone perfectly",
      "season 2 being a farming simulator actually made it better than season 1",
      "canute's speech about love and god hitting the priest was deep"
    ]
  },
  {
    title: 'Cyberpunk: Edgerunners', movieId: '90001', genre: 'Sci-Fi, Action',
    lore: [
      "david putting on the sandevistan knowing it would fry his brain... man",
      "adam smasher pulling up at the end was literal terror",
      "rebecca didn't deserve to get squashed like that bro",
      "lucy on the moon by herself with the song playing ruined my week",
      "maine going cyberpsycho in the desert was hard to watch"
    ]
  },
  {
    title: 'Chainsaw Man', movieId: '114410', genre: 'Action, Dark Fantasy',
    lore: [
      "himeno vomiting in denji's mouth is still the wildest scene",
      "aki's morning routine being animated so beautifully just to hurt us later",
      "makima is terrifying, the train scene where she just stands up...",
      "the katana man nut-kicking tournament at the end was peak cinema",
      "power is carrying the comedy on her back"
    ]
  }
  // Note: Add the other 40 anime here using the EXACT same format to hit 1000+ lines.
];

const movieData = [
  {
    title: 'Interstellar', movieId: '91001', genre: 'Sci-Fi, Drama',
    lore: [
      "the docking scene with no time for caution playing is peak cinema",
      "cooper watching 23 years of messages in one sitting made me tear up",
      "dr mann faking the data just to be rescued is such a human flaw",
      "the tesseract scene explaining the ghost in the bookshelf was mindblowing",
      "miller's planet where every tick of the music is a day passing on earth... details"
    ]
  },
  {
    title: 'Inception', movieId: '91002', genre: 'Sci-Fi, Thriller',
    lore: [
      "the hallway zero gravity fight scene practical effects still hold up",
      "cobb spinning the top at the end and the screen cutting to black is evil",
      "mal sabotaging the missions because she thought it was a dream was terrifying",
      "tom hardy's 'you mustn't be afraid to dream a little bigger darling' is cold",
      "the kick synchronization falling into the water in slow mo is so satisfying"
    ]
  },
  {
    title: 'The Dark Knight', movieId: '91003', genre: 'Action, Crime',
    lore: [
      "the joker interrogation scene is the best acted scene in cbm history",
      "harvey dent's coin flip transition to two-face was perfectly executed",
      "the ferry experiment tension was crazy, glad the prisoners threw the detonator",
      "joker walking out of the hospital in a nurse outfit while it blows up is iconic",
      "batman taking the blame at the end so the city has a hero... chills"
    ]
  },
  {
    title: 'Fight Club', movieId: '91004', genre: 'Drama',
    lore: [
      "the plot twist that tyler durden isn't real still hits on a rewatch",
      "the narrator beating himself up in the boss's office is hilarious and unhinged",
      "project mayhem blowing up the credit card buildings while 'where is my mind' plays",
      "bob's death actually hurt, his name is robert paulson",
      "the chemical burn scene where tyler forces him to feel the pain"
    ]
  },
  {
    title: 'Se7en', movieId: '91005', genre: 'Crime, Thriller',
    lore: [
      "what's in the box is the most stressful scene in movie history",
      "the sloth victim actually being alive when swat checked him gave me a heart attack",
      "john doe turning himself in covered in blood halfway through the movie was wild",
      "the fact that doe won in the end by making mills the wrath sin is brilliant writing",
      "the gluttony scene is genuinely hard to watch while eating"
    ]
  },
  {
    title: 'Parasite', movieId: '91006', genre: 'Thriller, Drama',
    lore: [
      "the rain storm destroying the poor neighborhood while the rich mom calls it a blessing",
      "finding the old housekeeper's husband in the secret bunker changed the whole movie",
      "the smell motif where the dad snaps because mr park holds his nose",
      "the peach fuzz allergy scheme was so evil but genius",
      "the ending where he imagines buying the house but he's still in the basement is depressing"
    ]
  },
  {
    title: 'Whiplash', movieId: '91007', genre: 'Drama, Music',
    lore: [
      "fletcher throwing the chair at his head for rushing the tempo",
      "andrew getting into a literal car crash and still running to the stage bleeding",
      "the final drum solo where fletcher finally nods at him... cinema",
      "the 'were you rushing or dragging' slap scene is intense af",
      "breaking up with his girlfriend just so he can drum more is psycho behavior"
    ]
  },
  {
    title: 'Spider-Man: Into the Spider-Verse', movieId: '91008', genre: 'Animation',
    lore: [
      "the leap of faith scene with the glass shattering and the music swelling",
      "uncle aaron being the prowler was a crazy twist if you didn't read the comics",
      "the animation framing where miles is rising not falling",
      "kingpin's design being just a massive block of black is so stylistic",
      "peter b parker eating the burger in sweatpants is my spirit animal"
    ]
  },
  {
    title: 'The Social Network', movieId: '91009', genre: 'Drama',
    lore: [
      "the 'you have part of my attention' deposition scene is zuckerberg at his most arrogant",
      "andrew garfield smashing the laptop when his shares got diluted was acting class",
      "justin timberlake playing sean parker paranoid about the cops",
      "the rowing race scene with the trent reznor soundtrack was shot beautifully",
      "the final scene of him just refreshing the friend request page over and over"
    ]
  },
  {
    title: 'Prisoners', movieId: '91010', genre: 'Thriller',
    lore: [
      "hugh jackman interrogating paul dano in the abandoned bathroom is raw tension",
      "the ending with the whistle faintly blowing while jake gyllenhaal walks away",
      "finding the guy with the maze drawn all over his walls",
      "the aunt making them drink the poison... the desperation in that scene",
      "the bloody clothes in the basement fakeout was cruel directing"
    ]
  }
  // Note: Add the other 40 movies here using the EXACT same format to hit 1000+ lines.
];

// Combine all media
const allMedia = [...animeData, ...movieData];

// Thread Titles tailored to real discussions
const threadTitles = [
  "Hot take on {title}",
  "Did anyone else notice this in {title}?",
  "Bro {title} actually ruined my mental health",
  "Unpopular opinion about {title}",
  "We need to talk about the ending of {title}",
  "Is {title} actually peak or overrated?",
  "Just finished {title} and I have thoughts",
  "The directing in {title} goes so hard",
  "Why is no one talking about this scene in {title}",
  "Rewatch thread: {title}"
];

const genericAgreements = [
  "bro actually cooked with this take", "nah fr you are speaking facts", 
  "i was thinking the exact same thing", "W take honestly", 
  "literally this. took the words out of my mouth", "100% agree with u"
];

const genericDisagreements = [
  "nah u are watching with your eyes closed", "L take. did we even watch the same thing?", 
  "this is heavily cap", "bro lacks media literacy im crying", 
  "imma have to disagree, the pacing was fine", "worst take ive seen on this forum today"
];

const genericReactions = [
  "im still not over it 💀", "ts had me staring at my wall for 20 mins", 
  "the animation/cinematography carried hard", "my jaw was literally on the floor",
  "the soundtrack during that part was absolutely insane"
];

function makeUsers() {
  const users = [];
  const tiers = ['Free', 'Free', 'Free', 'Premium', 'Gold'];
  const passHash = '$2b$10$cNEPvsPkiIiwzSqw1A.qEutpmYK..DtbImPv.xz/VOMzMNMN/xf3a';
  
  const randomHex = (len) => {
    let out = '';
    const chars = '0123456789abcdef';
    for (let i = 0; i < len; i++) out += chars[Math.floor(rand() * chars.length)];
    return out;
  };

  const usernames = [];
  for (let i = 0; i < 80; i++) usernames.push(normalHandleSeeds[i]);
  for (let i = 0; i < 20; i++) usernames.push(`Userx${randomHex(7)}`);
  
  const shuffledUsers = shuffle(usernames);

  for (let i = 0; i < 100; i++) {
    const uid = 5 + i;
    users.push({
      username: shuffledUsers[i],
      userUID: uid,
      userEmail: `${shuffledUsers[i]}@mailbox.com`,
      userTier: pick(tiers),
      userLanguage: 'en',
      searchCount: Math.floor(rand() * 40),
      viewCount: Math.floor(rand() * 18),
      allUIDs: [uid],
      userPassword: passHash
    });
  }
  return users;
}

function makeForumMoviesAndThreads(users) {
  const forumMovies = [];
  const forumThreads = [];
  let threadSeq = 0;

  for (let i = 0; i < allMedia.length; i++) {
    const media = allMedia[i];
    const starterUser = users[Math.floor(rand() * users.length)];
    
    // Spread movie added dates
    const movieDate = randomDateBetween(START_DATE, END_DATE - (60 * 24 * 60 * 60 * 1000));
    const poster = `https://placehold.co/500x750/111111/ffffff?text=${encodeURIComponent(media.title)}`;

    forumMovies.push({
      movieId: media.movieId,
      movieTitle: media.title,
      poster,
      genre: media.genre,
      addedBy: starterUser.username,
      addedByUID: starterUser.userUID,
      createdAt: movieDate.toISOString()
    });

    // Generate 2 to 5 threads per title
    const threadCount = randInt(2, 5);
    
    for (let k = 0; k < threadCount; k++) {
      const threadAuthor = users[Math.floor(rand() * users.length)];
      const threadTime = randomDateBetween(movieDate.getTime(), END_DATE - (10 * 24 * 60 * 60 * 1000));
      
      const rawTitle = pick(threadTitles).replace('{title}', media.title);
      const threadTitle = applyTypos(rawTitle);

      // Thread body: Mix of generic rants and specific lore drops
      let threadDesc = "";
      if (rand() > 0.4) {
        threadDesc = `can we talk about how ${pick(media.lore)}? because honestly ${pick(genericReactions)}`;
      } else {
        threadDesc = `just finished this and wow. ${pick(genericReactions)} drop ur favorite moments below.`;
      }
      threadDesc = applyTypos(threadDesc);

      const threadId = String(1778000000000 + threadSeq);
      threadSeq += 1;

      const comments = [];
      // 10 to 15 comments per thread
      const commentCount = randInt(10, 15);
      const commentUsers = shuffle(users).slice(0, commentCount);
      let lastCommentTime = threadTime.getTime();

      for (let c = 0; c < commentCount; c++) {
        const cu = commentUsers[c];
        let text = "";
        
        // Randomly decide comment archetype
        const roll = rand();
        if (roll < 0.3) {
          // Drops a lore fact
          text = `nah fr, especially when ${pick(media.lore)}. crazy writing.`;
        } else if (roll < 0.5) {
          // Disagrees
          text = `${pick(genericDisagreements)}`;
        } else if (roll < 0.8) {
          // Agrees
          text = `${pick(genericAgreements)}`;
        } else {
          // Generic reaction
          text = `${pick(genericReactions)}`;
        }

        // Apply grammatical degradation
        text = applyTypos(text);

        // Sequence times realistically
        const commentTime = new Date(Math.min(END_DATE, lastCommentTime + randInt(5 * 60 * 1000, 72 * 60 * 60 * 1000)));
        lastCommentTime = commentTime.getTime();

        comments.push({
          id: String(1889000000000 + threadSeq * 100 + c),
          userUID: cu.userUID,
          username: cu.username,
          text,
          createdAt: commentTime.toISOString(),
          upvotes: Math.floor(rand() * 80), 
          voters: {}
        });
      }

      forumThreads.push({
        id: threadId,
        movieId: media.movieId,
        title: threadTitle,
        description: threadDesc,
        image: poster,
        username: threadAuthor.username,
        userUID: threadAuthor.userUID,
        score: Math.floor(rand() * 200) - 20, 
        voters: {},
        comments,
        createdAt: threadTime.toISOString()
      });
    }
  }

  forumThreads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  forumMovies.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  return { forumMovies, forumThreads };
}

function main() {
  const users = makeUsers();
  const { forumMovies, forumThreads } = makeForumMoviesAndThreads(users);

  // Count total comments generated
  let totalComments = 0;
  forumThreads.forEach(t => totalComments += t.comments.length);

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      note: 'Offline Lore-Injected Generator',
      usersCount: users.length,
      forumMoviesCount: forumMovies.length,
      forumThreadsCount: forumThreads.length,
      totalComments: totalComments
    },
    users,
    forum_movies: forumMovies,
    forum_threads: forumThreads
  };

  const outPath = path.join(__dirname, 'testbotcomments.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`MASSIVE DB GENERATED: Wrote ${forumThreads.length} threads and ${totalComments} human-like comments to ${outPath}`);
}

main();