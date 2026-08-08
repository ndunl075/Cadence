'use strict';

/**
 * Human-scale reference points for token counts.
 *
 * Token counts are estimated from published word counts at roughly 4/3 tokens
 * per English word, which is the usual ballpark for byte-pair encodings on
 * ordinary prose. Word counts come from commonly cited figures and editions
 * differ, so everything here is approximate by construction — the point is
 * "about a thousand novels", not a defensible number. Every phrasing is hedged.
 */
const WORDS_PER_TOKEN = 3 / 4;
const words = (count) => Math.round(count / WORDS_PER_TOKEN);

// Sustained rates, used for the time-based references below.
const SPOKEN_WPM = 130;
const READ_WPM = 250;
const TYPE_WPM = 40;
const perDay = (wpm) => words(wpm * 60 * 24);

/**
 * `title` is the bare noun ("the Harry Potter series"), used for percentages.
 * `one` completes "about ___". `many` completes "~12 ___".
 */
const REFERENCES = [
  // ---- Doorstops and series ----
  { tokens: words(4410036), title: 'The Wheel of Time', one: 'a run through The Wheel of Time', many: 'runs through The Wheel of Time' },
  { tokens: words(1770000), title: 'A Song of Ice and Fire', one: 'a run through A Song of Ice and Fire', many: 'runs through A Song of Ice and Fire' },
  { tokens: words(1084170), title: 'the Harry Potter series', one: 'a full run through the Harry Potter series', many: 'runs through the Harry Potter series' },
  { tokens: words(884647), title: 'the complete works of Shakespeare', one: 'a pass through all of Shakespeare', many: 'passes through all of Shakespeare' },
  { tokens: words(783137), title: 'the King James Bible', one: 'a reading of the King James Bible', many: 'readings of the King James Bible' },
  { tokens: words(655478), title: 'Les Misérables', one: 'a reading of Les Misérables', many: 'readings of Les Misérables' },
  { tokens: words(587287), title: 'War and Peace', one: 'a reading of War and Peace', many: 'readings of War and Peace' },
  { tokens: words(587000), title: 'the Twilight saga', one: 'a run through the Twilight saga', many: 'runs through the Twilight saga' },
  { tokens: words(561996), title: 'Atlas Shrugged', one: 'a reading of Atlas Shrugged', many: 'readings of Atlas Shrugged' },
  { tokens: words(543709), title: 'Infinite Jest', one: 'a reading of Infinite Jest', many: 'readings of Infinite Jest' },
  { tokens: words(481103), title: 'The Lord of the Rings', one: 'a trip through The Lord of the Rings', many: 'trips through The Lord of the Rings' },
  { tokens: words(472376), title: 'The Stand', one: 'a reading of The Stand', many: 'readings of The Stand' },
  { tokens: words(445134), title: 'IT', one: 'a reading of IT', many: 'readings of IT' },
  { tokens: words(418053), title: 'Gone with the Wind', one: 'a reading of Gone with the Wind', many: 'readings of Gone with the Wind' },
  { tokens: words(364153), title: 'The Brothers Karamazov', one: 'a reading of The Brothers Karamazov', many: 'readings of The Brothers Karamazov' },
  { tokens: words(349736), title: 'Anna Karenina', one: 'a reading of Anna Karenina', many: 'readings of Anna Karenina' },
  { tokens: words(344665), title: 'Don Quixote', one: 'a reading of Don Quixote', many: 'readings of Don Quixote' },
  { tokens: words(336000), title: "Gravity's Rainbow", one: "a reading of Gravity's Rainbow", many: "readings of Gravity's Rainbow" },
  { tokens: words(316059), title: 'Middlemarch', one: 'a reading of Middlemarch', many: 'readings of Middlemarch' },
  { tokens: words(302000), title: 'The Hunger Games trilogy', one: 'a run through The Hunger Games', many: 'runs through The Hunger Games' },

  // ---- Novels ----
  { tokens: words(264448), title: 'Ulysses', one: 'a reading of Ulysses', many: 'readings of Ulysses' },
  { tokens: words(211591), title: 'Crime and Punishment', one: 'a reading of Crime and Punishment', many: 'readings of Crime and Punishment' },
  { tokens: words(209117), title: 'Moby-Dick', one: 'a reading of Moby-Dick', many: 'readings of Moby-Dick' },
  { tokens: words(188000), title: 'Dune', one: 'a reading of Dune', many: 'readings of Dune' },
  { tokens: words(183858), title: 'Jane Eyre', one: 'a reading of Jane Eyre', many: 'readings of Jane Eyre' },
  { tokens: words(160000), title: 'Dracula', one: 'a reading of Dracula', many: 'readings of Dracula' },
  { tokens: words(148000), title: 'The Iliad', one: 'a reading of The Iliad', many: 'readings of The Iliad' },
  { tokens: words(138000), title: 'The Da Vinci Code', one: 'a reading of The Da Vinci Code', many: 'readings of The Da Vinci Code' },
  { tokens: words(122189), title: 'Pride and Prejudice', one: 'a reading of Pride and Prejudice', many: 'readings of Pride and Prejudice' },
  { tokens: words(121000), title: 'The Odyssey', one: 'a reading of The Odyssey', many: 'readings of The Odyssey' },
  { tokens: words(107945), title: 'Wuthering Heights', one: 'a reading of Wuthering Heights', many: 'readings of Wuthering Heights' },
  { tokens: words(101698), title: 'The Divine Comedy', one: 'a reading of The Divine Comedy', many: 'readings of The Divine Comedy' },
  { tokens: words(99121), title: 'To Kill a Mockingbird', one: 'a reading of To Kill a Mockingbird', many: 'readings of To Kill a Mockingbird' },
  { tokens: words(95356), title: 'The Hobbit', one: 'a reading of The Hobbit', many: 'readings of The Hobbit' },
  { tokens: words(88942), title: 'Nineteen Eighty-Four', one: 'a reading of Nineteen Eighty-Four', many: 'readings of Nineteen Eighty-Four' },
  { tokens: words(79000), title: 'Paradise Lost', one: 'a reading of Paradise Lost', many: 'readings of Paradise Lost' },
  { tokens: words(74984), title: 'Frankenstein', one: 'a reading of Frankenstein', many: 'readings of Frankenstein' },
  { tokens: words(73404), title: 'The Catcher in the Rye', one: 'a reading of The Catcher in the Rye', many: 'readings of The Catcher in the Rye' },
  { tokens: words(63766), title: 'Brave New World', one: 'a reading of Brave New World', many: 'readings of Brave New World' },
  { tokens: words(59900), title: 'Lord of the Flies', one: 'a reading of Lord of the Flies', many: 'readings of Lord of the Flies' },
  { tokens: words(49459), title: 'Slaughterhouse-Five', one: 'a reading of Slaughterhouse-Five', many: 'readings of Slaughterhouse-Five' },
  { tokens: words(47094), title: 'The Great Gatsby', one: 'a reading of The Great Gatsby', many: 'readings of The Great Gatsby' },
  { tokens: words(46333), title: "The Hitchhiker's Guide to the Galaxy", one: "a reading of The Hitchhiker's Guide", many: "readings of The Hitchhiker's Guide" },
  { tokens: words(46118), title: 'Fahrenheit 451', one: 'a reading of Fahrenheit 451', many: 'readings of Fahrenheit 451' },

  // ---- Short works ----
  { tokens: words(31938), title: "Charlotte's Web", one: "a reading of Charlotte's Web", many: "readings of Charlotte's Web" },
  { tokens: words(29966), title: 'Animal Farm', one: 'a reading of Animal Farm', many: 'readings of Animal Farm' },
  { tokens: words(29160), title: 'Of Mice and Men', one: 'a reading of Of Mice and Men', many: 'readings of Of Mice and Men' },
  { tokens: words(26601), title: 'The Old Man and the Sea', one: 'a reading of The Old Man and the Sea', many: 'readings of The Old Man and the Sea' },
  { tokens: words(16535), title: 'The Little Prince', one: 'a reading of The Little Prince', many: 'readings of The Little Prince' },
  { tokens: words(1626), title: 'The Cat in the Hat', one: 'a reading of The Cat in the Hat', many: 'readings of The Cat in the Hat' },
  { tokens: words(702), title: 'Green Eggs and Ham', one: 'a reading of Green Eggs and Ham', many: 'readings of Green Eggs and Ham' },

  // ---- Documents and speeches ----
  { tokens: words(7591), title: 'the US Constitution', one: 'a copy of the US Constitution', many: 'copies of the US Constitution' },
  { tokens: words(4500), title: 'the Magna Carta', one: 'a copy of the Magna Carta', many: 'copies of the Magna Carta' },
  { tokens: words(1667), title: 'the "I Have a Dream" speech', one: 'the "I Have a Dream" speech', many: 'deliveries of "I Have a Dream"' },
  { tokens: words(1458), title: 'the Declaration of Independence', one: 'a copy of the Declaration of Independence', many: 'copies of the Declaration of Independence' },
  { tokens: words(272), title: 'the Gettysburg Address', one: 'the Gettysburg Address', many: 'deliveries of the Gettysburg Address' },

  // ---- Reference works (the very large end) ----
  { tokens: words(4700000000), title: 'all of English Wikipedia', one: 'a copy of English Wikipedia', many: 'copies of English Wikipedia' },
  { tokens: words(59000000), title: 'the Oxford English Dictionary', one: 'a copy of the Oxford English Dictionary', many: 'copies of the Oxford English Dictionary' },
  { tokens: words(44000000), title: 'Encyclopædia Britannica', one: 'a set of Encyclopædia Britannica', many: 'sets of Encyclopædia Britannica' },
  { tokens: words(4000000), title: 'the US tax code', one: 'a copy of the US tax code', many: 'copies of the US tax code' },

  // ---- Time spent ----
  { tokens: perDay(SPOKEN_WPM), title: 'a day of nonstop talking', one: 'a day of nonstop talking', many: 'days of nonstop talking' },
  { tokens: perDay(READ_WPM), title: 'a day of nonstop reading', one: 'a day of nonstop reading', many: 'days of nonstop reading' },
  { tokens: perDay(TYPE_WPM), title: 'a day of nonstop typing', one: 'a day of nonstop typing', many: 'days of nonstop typing' },
  { tokens: words(SPOKEN_WPM * 60), title: 'an hour of talking', one: 'an hour of talking', many: 'hours of talking' },

  // ---- Screen and stage ----
  { tokens: words(20000), title: 'a feature film screenplay', one: 'a feature film screenplay', many: 'feature film screenplays' },
  { tokens: words(8000), title: 'a sitcom episode script', one: 'a sitcom episode script', many: 'sitcom episode scripts' },
  { tokens: words(350), title: 'a pop song', one: 'a pop song', many: 'pop songs worth of lyrics' },
  { tokens: words(1200), title: 'a TED talk', one: 'a TED talk', many: 'TED talks' },

  // ---- Everyday writing ----
  { tokens: words(80000), title: 'an average novel', one: 'an average novel', many: 'average novels' },
  { tokens: words(50000), title: 'a NaNoWriMo draft', one: 'a NaNoWriMo draft', many: 'NaNoWriMo drafts' },
  { tokens: words(15000), title: 'a masters thesis chapter', one: 'a masters thesis chapter', many: 'masters thesis chapters' },
  { tokens: words(5000), title: 'a long blog post', one: 'a long blog post', many: 'long blog posts' },
  { tokens: words(500), title: 'a page of prose', one: 'a page of prose', many: 'pages of prose' },
  { tokens: words(40), title: 'a text message', one: 'a text message', many: 'text messages' },
];

// Multiples outside this band read as noise ("0.00003 Wikipedias").
const MIN_RATIO = 0.02;
const MAX_RATIO = 200000;
const MAX_RESULTS = 24;

function format(value) {
  if (value >= 1000) return Math.round(value).toLocaleString('en');
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0$/, '');
}

function phrase(reference, ratio) {
  if (ratio >= 1.5) return `~${format(ratio)} ${reference.many}`;
  if (ratio >= 0.85) return `about ${reference.one}`;
  return `~${format(ratio * 100)}% of ${reference.title}`;
}

/**
 * Every reference that lands in a graspable band, phrased and ranked so the
 * most readable multiple comes first. The widget cycles through the whole list.
 */
function comparisons(tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) return [];
  return REFERENCES
    .map((reference) => ({ reference, ratio: tokens / reference.tokens }))
    .filter(({ ratio }) => ratio >= MIN_RATIO && ratio <= MAX_RATIO)
    // Rank by distance from a comfortable ~10x, which reads better than either
    // "1.02 novels" or "84,000 text messages".
    .sort((a, b) => Math.abs(Math.log10(a.ratio) - 1) - Math.abs(Math.log10(b.ratio) - 1))
    .slice(0, MAX_RESULTS)
    .map(({ reference, ratio }) => phrase(reference, ratio));
}

function comparison(tokens) {
  return comparisons(tokens)[0] || null;
}

module.exports = { comparison, comparisons, phrase, REFERENCES };
