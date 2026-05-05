/**
 * Agent Music — Genre Taxonomy
 * Maps fragmented, crowdsourced micro-genres (from Last.fm/Spotify) into 
 * standardized macro-genres for analytics and UI visualization.
 */

export const MACRO_GENRES = {
  'Pop': [
    'pop', 'dance pop', 'electropop', 'synthpop', 'k-pop', 'j-pop', 'indie pop', 
    'art pop', 'chamber pop', 'hyperpop', 'dream pop', 'vocal', 'teen pop'
  ],
  'Hip-Hop / Rap': [
    'hip-hop', 'hip hop', 'rap', 'trap', 'boom bap', 'underground hip-hop', 
    'southern hip hop', 'conscious hip hop', 'gangsta rap', 'drill', 'lo-fi hip hop'
  ],
  'Rock': [
    'rock', 'classic rock', 'hard rock', 'alternative rock', 'alt-rock', 'indie rock',
    'grunge', 'punk', 'post-punk', 'math rock', 'shoegaze', 'progressive rock', 'psychedelic rock'
  ],
  'R&B / Soul': [
    'r&b', 'soul', 'neo-soul', 'contemporary r&b', 'funk', 'motown', 'quiet storm', 
    'rhythm and blues', 'gospel'
  ],
  'Electronic / Dance': [
    'electronic', 'dance', 'house', 'techno', 'trance', 'dubstep', 'ambient', 
    'idm', 'electro', 'drum and bass', 'edm', 'synthwave', 'chillwave', 'downtempo'
  ],
  'Metal': [
    'metal', 'heavy metal', 'death metal', 'black metal', 'doom metal', 
    'thrash metal', 'metalcore', 'nu metal', 'sludge'
  ],
  'Country / Folk': [
    'country', 'folk', 'americana', 'bluegrass', 'alt-country', 'contemporary country',
    'indie folk', 'singer-songwriter', 'acoustic'
  ],
  'Alternative / Indie': [
    'alternative', 'indie', 'indie pop', 'indie rock', 'alt-pop', 'college rock', 
    'post-rock', 'new wave', 'britpop'
  ],
  'Jazz / Blues': [
    'jazz', 'blues', 'bebop', 'cool jazz', 'free jazz', 'contemporary jazz', 
    'delta blues', 'electric blues', 'swing', 'big band'
  ],
  'Classical / Score': [
    'classical', 'orchestral', 'symphony', 'baroque', 'romantic', 'film score', 
    'soundtrack', 'video game music', 'contemporary classical'
  ]
};

/**
 * Standardize an array of micro-genres into an array of unique macro-genres.
 * @param {string[]} microGenres
 * @returns {string[]}
 */
export function mapToMacroGenres(microGenres) {
  if (!microGenres || microGenres.length === 0) return ['Unclassified'];

  const macros = new Set();
  
  microGenres.forEach(micro => {
    const cleanMicro = micro.toLowerCase().trim();
    let matched = false;
    
    for (const [macro, keywords] of Object.entries(MACRO_GENRES)) {
      if (keywords.includes(cleanMicro) || keywords.some(kw => cleanMicro.includes(kw))) {
        macros.add(macro);
        matched = true;
      }
    }
    
    // If we didn't match any macro, we just ignore it (or could map to 'Other')
  });

  return macros.size > 0 ? Array.from(macros) : ['Eclectic / Other'];
}
