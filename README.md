# Virtual Fly Brain Cafe

A quiet, browser-only piano room inspired by ambient cafe timers. The room is
decorated with an upright piano, fly, stool, coffee, plant, bookshelf, and
night window. The fly brain status is presented as a soft dopamine waveform
and neural activity field.

## Audio

The fly performs ten public-domain melodies as piano arrangements, including
`Ode to Joy`, `Für Elise`, `Moonlight Sonata`, `Canon in D`, `Greensleeves`,
`Amazing Grace`, `Jingle Bells`, `Happy Birthday`, `Scarborough Fair`, and
`Beethoven Fifth`.

The piano has exactly 24 keys. During training, the next target key is
highlighted. The fly selects one key per beat: a correct selection produces a
dopamine reward, while a wrong selection produces punishment. Each trial
updates the fly's per-song, per-position policy and reduces exploration, so
the performance converges on the target melody.

## Run

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Audio starts only after a user gesture because
modern browsers block autoplay.

The connectome data remains available for future neural experiments, while the
former arcade presentation and game runtime are no longer part of the app.
