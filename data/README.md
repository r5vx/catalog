# data

`film-neighbours.bin` — for each film (by TMDB id), the films most like it, used by "More like
this" (`src/lib/server/recommendations.ts`). Built by `scripts/build-film-neighbours.mjs` from the
MovieLens "ml-latest" dataset (F. Maxwell Harper and Joseph A. Konstan, 2015, *The MovieLens
Datasets: History and Context*, ACM TiiS 5(4); grouplens.org), July 2023 edition.

It is a transformation of that dataset and is passed on under the same terms: it may be used for
non-commercial purposes only, and may be redistributed only under these same conditions. It is not
endorsed by the University of Minnesota or the GroupLens Research Group.

Format: `CFN1`, film count (u32), then for each film sorted by TMDB id its id (u32) and the offset
of its list (u32); each list is a count (u8) then that many (TMDB id u32, score u8 0–255).
