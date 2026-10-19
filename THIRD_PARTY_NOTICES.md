# Third-party notices

AllsAmple's own code is MIT licensed. Third-party code retains its original license.

## SampleTap

Copyright nisesimadao. MIT License.

The unmodified audio URL resolver and its original regression tests are included in
`vendor/sampletap/`, with the upstream license. Source:
https://github.com/nisesimadao/SampleTap/tree/c7822a79230db1d189fcd9860b3560f39599db9a

## SoundTouchJS 2.1.1

Copyright Steve 'Cutter' Blades and contributors. Mozilla Public License 2.0.

AllsAmple uses the unmodified `@soundtouchjs/audio-worklet` distribution and its
bundled SoundTouchJS processing code for auditioning tempo and pitch changes.
Original copyright notices remain in the distributed JavaScript. These changes
are applied during playback; exported audio files are not transformed.

The upstream license notice is included as `licenses/SoundTouchJS-MPL-2.0.txt`,
and the complete MPL 2.0 text as `licenses/MPL-2.0.txt`.
The corresponding upstream source is available at:
https://github.com/cutterbl/SoundTouchJS/tree/d9e39a7ddcf74c7a145bbba45856f30068c82b79
(tag `v2.1.1`). AllsAmple has made no modifications to those upstream files.

Other dependencies include Electron (MIT), Playwright (Apache 2.0), Cheerio (MIT),
and music-metadata (MIT). Their original license files are retained in the
distributed dependency packages. Electron also includes its Chromium notices.

## Interface assets

Selected Lucide icons (ISC, including the upstream Feather MIT notice) and Radix Colors (MIT) are generated into the renderer as SVG and CSS. The complete original notices are bundled in `licenses/Lucide-LICENSE.txt` and `licenses/Radix-Colors-MIT.txt`. Their build-time packages are not runtime dependencies.
