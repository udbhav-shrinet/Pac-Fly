# Virtual Fly Brain Cafe

A quiet, browser-only piano room inspired by ambient cafe timers. The room is
decorated with an upright piano, fly, stool, coffee, plant, bookshelf, and
night window. The fly brain status is presented as a soft dopamine waveform
and neural activity field.

## Audio

The built-in player performs real public-domain melodies as piano arrangements:
`Ode to Joy`, `Greensleeves`, and `Canon in D`. Click play to hear them, or
touch any piano key for a note. The **Load your song** control accepts a local
audio file, so licensed recordings such as *Waving Flag* can be played without
redistributing copyrighted music.

## Run

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Audio starts only after a user gesture because
modern browsers block autoplay.

The connectome data remains available for future neural experiments, while the
former arcade presentation and game runtime are no longer part of the app.
