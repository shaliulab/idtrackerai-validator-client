// HelpTab.js  —  "How to use" tab: a guide to the app, with a table of contents.
//
// Static text. When a feature, button or shortcut changes, update it here too.

import React from 'react';

const Key = ({ children }) => <kbd className="help-kbd">{children}</kbd>;

const SECTIONS = [
  { id: 'help-overview', title: 'What this app is for' },
  { id: 'help-start', title: 'Getting started' },
  { id: 'help-viewer', title: 'Group viewer' },
  { id: 'help-pe', title: 'Proboscis extension (PE)' },
  { id: 'help-ethogram', title: 'Ethograms' },
  { id: 'help-qc', title: 'QC' },
  { id: 'help-pose', title: 'Pose' },
  { id: 'help-overview-tab', title: 'Metadata overview' },
  { id: 'help-data', title: 'Data management' },
  { id: 'help-monitor', title: 'Monitor' },
  { id: 'help-keys', title: 'Keyboard & mouse' },
  { id: 'help-glossary', title: 'Glossary' },
];

function Section({ id, title, children }) {
  return (
    <section id={id} className="card help-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const SHORTCUTS = [
  ['Anywhere', [
    [<><Key>Ctrl</Key>+<Key>1</Key> / <Key>2</Key> / <Key>3</Key> / <Key>4</Key> / <Key>5</Key> / <Key>6</Key> / <Key>7</Key> / <Key>8</Key> / <Key>9</Key></>, 'Switch to Group viewer / PE / Ethograms / QC / Pose / Metadata overview / Data management / Monitor / How to use (the tabs, left to right)'],
  ]],
  ['Group viewer', [
    [<><Key>1</Key> / <Key>7</Key></>, 'Previous / next chunk'],
    [<><Key>2</Key> / <Key>6</Key></>, 'Back / forward 10 s'],
    [<><Key>3</Key> / <Key>5</Key></>, 'Back / forward 1 s'],
    [<Key>4</Key>, 'Play / pause'],
    [<><Key>8</Key> / <Key>9</Key></>, 'Previous / next rejection'],
    ['Mouse wheel on the frame', 'Scrub (one notch = "Playback framerate" frames); pauses playback'],
    ['Middle click on the frame', 'Play / pause'],
    ['Hover over the frame', 'Magnifying glass'],
  ]],
  ['Pose', [
    [<><Key>←</Key> / <Key>→</Key></>, 'Previous / next frame (with Shift: 10 frames)'],
    [<><Key>↑</Key> / <Key>↓</Key></>, 'Previous / next fly'],
    ['Hover a body part or its table row', 'Its name, confidence and position'],
  ]],
  ['PE', [
    [<><Key>1</Key>–<Key>7</Key></>, 'Verdict for the selected bout: pe, feed, groom, walk, other, merge, unsure (same key again removes it)'],
    [<><Key>Shift</Key>+<Key>1</Key>–<Key>7</Key></>, 'Same verdict for every bout of the burst'],
    [<><Key>0</Key> / <Key>Backspace</Key></>, 'Clear the selected bout\'s verdict'],
    [<><Key>←</Key> / <Key>→</Key></>, 'Previous / next burst'],
    [<><Key>↑</Key> / <Key>↓</Key></>, 'Previous / next bout'],
    [<Key>n</Key>, 'Next burst with an unlabeled bout'],
    [<><Key>k</Key> / <Key>j</Key></>, 'Next / previous unreviewed burst (audit mode)'],
    [<><Key>Ctrl</Key>+<Key>Shift</Key>+<Key>1</Key>–<Key>9</Key></>, 'Select the Nth fly'],
    ['Drag on a trace', 'Scrub the burst video'],
    [<><Key>Shift</Key>+drag on the distance trace</>, 'Draw a ground-truth event'],
  ]],
  ['Ethograms', [
    [<><Key>↑</Key> / <Key>↓</Key></>, 'Previous / next fly'],
    [<><Key>←</Key> / <Key>→</Key></>, 'Move the cursor 1 s (with Shift: 10 s, Ctrl: 60 s, Ctrl+Alt: 10 min)'],
    [<><Key>+</Key> / <Key>−</Key></>, 'Zoom in / out around the cursor'],
    [<Key>Space</Key>, 'Play / pause the movie'],
    ['Wheel on the ethogram', 'Zoom around the pointer (Shift+wheel: pan)'],
    ['Drag on the ethogram', 'Pan; a click moves the cursor, a double click zooms in'],
    [<><Key>Shift</Key>+drag on the ethogram</>, 'Select seconds to label for deepethogram'],
    [<><Key>[</Key> / <Key>]</Key></>, 'Start / end the selection at the cursor (Esc drops it)'],
    [<><Key>1</Key> … <Key>6</Key>, <Key>0</Key></>, 'Label the selection (else the cursor\'s second) for DEG: 1 walk, 2 groom, 3 feed, 4 inactive + micromovement, 5 inactive, 6 inactive + PE, 0 background; Delete = None, removes its labels'],
    [<><Key>Ctrl</Key>+<Key>Z</Key></>, 'Ethograms: undo the last DEG label applied'],
    [<><Key>Ctrl</Key>+<Key>Y</Key>, <Key>Ctrl</Key>+<Key>Shift</Key>+<Key>Z</Key></>, 'Ethograms: redo the last DEG label undone'],
  ]],
];

export default function HelpTab() {
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="help">
      <nav className="help-toc card">
        <div className="card-header">Contents</div>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}><button onClick={() => jump(s.id)}>{s.title}</button></li>
          ))}
        </ul>
      </nav>

      <div className="help-body">
        <Section id="help-overview" title="What this app is for">
          <p>
            The FlyHostel Viewer is used to review the results of tracking flies in
            FlyHostel experiments. In each experiment several flies share an arena
            and are filmed for days. <b>YOLOv7</b> finds the flies in every frame,
            and <b>idtrackerai</b> assigns each fly an <i>identity</i> that it keeps
            for the whole recording.
          </p>
          <p>The app lets you:</p>
          <ul>
            <li><b>check identities</b> frame by frame, and find the frames where tracking failed or was corrected (Group viewer);</li>
            <li><b>annotate proboscis extension</b> events picked up by the pose pipeline (PE tab);</li>
            <li><b>browse each fly's behaviour</b> over the whole experiment and export sleep bout videos (Ethograms);</li>
            <li><b>count the frames that do not track every fly</b> of the loaded experiment, chunk by chunk, and check the quality of each fly's pose (QC);</li>
            <li><b>inspect the pose of one fly</b> frame by frame, with the confidence of each body part (Pose);</li>
            <li><b>see which experiments exist</b>, by genotype, group size, sex and any other metadata (Overview);</li>
            <li><b>free disk space</b> by deleting experiments that are backed up (Data management).</li>
          </ul>
          <p className="help-note">
            Each tab name shows its shortcut (<Key>Ctrl</Key>+<Key>1</Key>…<Key>8</Key>).
            Hover over a button to see what it does.
          </p>
        </Section>

        <Section id="help-start" title="Getting started">
          <ol>
            <li>
              <b>Load an experiment.</b> Choose one in <i>Browse available experiments…</i>
              in the top bar. All tabs follow the loaded experiment. Experiments not analyzed
              yet (no database, listed under <i>No database</i>, or <i>Open</i> in the
              Overview) show their recording and, once idtrackerai has started on them, its
              blobs; the PE and Ethograms tabs are grayed out for them. Next to the picker,{' '}
              <i className="fa fa-copy" /> copies the experiment name, and the loaded experiment's
              folder (basedir) is shown with its own <i className="fa fa-copy" /> (hover it for where
              the folder really is on disk).
            </li>
            <li>
              <b>Choose the tracking source.</b> Ticking <i>Validated tracking</i> reads
              identities from the validated tables (<code>IDENTITY_VAL</code>,{' '}
              <code>ROI_0_VAL</code>) instead of the raw tracking. Each experiment starts on
              the validated tables when it has more than one fly and they exist. Your
              choice lasts until the next experiment is loaded.
              The <i>Tracking</i> menu next to it switches from the database to{' '}
              <i>blobs_collection</i>: the blobs idtrackerai saved for the displayed chunk
              (<code>idtrackerai/session_&lt;chunk&gt;/</code>, most advanced step), handy to
              check an ongoing run. The tag beside it names the file (hover for when it was
              written); identity 0 means idtrackerai has not assigned one yet. The first
              frame of a chunk takes a few seconds while the file loads. <i>None</i> shows
              the recording only. Sources the experiment does not have are grayed out.
            </li>
            <li>
              <b>Watch the console.</b> The panel at the bottom shows messages, errors and the
              progress of long jobs, such as video exports. Click its title to fold it and
              drag its top edge to resize it.
            </li>
            <li>
              <b>Resize cards.</b> Most cards with a list or a table (Tracking, Navigation, ROIs,
              Validation CSV, the Overview charts and tables, the Data management table) can be
              made shorter or taller by dragging their bottom edge; the height is remembered.
              Double click the edge to return to the natural height.
            </li>
          </ol>
          <p className="help-note">
            The top bar also switches between light and dark theme. The small code in the
            top right corner is the version (git commit) of the running server; a{' '}
            <code>*</code> means it ran with uncommitted changes. Include it when you report a problem.
          </p>
        </Section>

        <Section id="help-viewer" title="Group viewer">
          <p>
            The frame is on the left and the tracking table and navigation on the right.
            Drag the bar between them to resize the frame; double click it to fit the
            frame to the window again.
          </p>

          <h3>The frame</h3>
          <ul>
            <li>
              Each fly is labelled at its centroid in its <b>identity colour</b>. Black means
              identity <b>0</b>: a detection that was not assigned to any fly. Use{' '}
              <i>Label</i> to show another field instead of the identity (area, fragment, …);
              the colour still follows the identity.
            </li>
            <li>
              <b>Hover</b> to open a magnifying glass. Its border takes the colour of the fly
              nearest to the cursor, and that fly's identity is shown in its top-left corner.
            </li>
            <li>
              <b>Scroll</b> over the frame to move through the video, and <b>middle click</b>{' '}
              to play or pause.
            </li>
            <li><i>Show pose</i> draws the pose skeletons when the experiment has them.</li>
          </ul>

          <h3>Tracking table</h3>
          <p>
            One row per detected fly in the current frame: position, identity, sex and
            genotype, idtrackerai details (local identity, fragment, area), the ZT time and the
            incubator's temperature (°C) and relative humidity (RH %) at that time (— when the
            incubator logged nothing then).
            You can type a frame number, a chunk or a frame index (within the displayed chunk) into the first columns to jump there.
          </p>
          <ul>
            <li><b>← z / z →</b> jump to the start of the previous / next sleep bout of that fly.</li>
            <li><b>etho</b> opens that fly's ethogram at the current frame.</li>
          </ul>

          <h3>Navigation</h3>
          <ul>
            <li>The <b>slider</b> covers the whole recording. The current frame, chunk and ZT are shown above it.</li>
            <li>
              The <b>transport buttons</b> step by chunk, 30 s, 10 s and 1 s, and play or pause.
              The last two jump to the previous / next <b>rejection</b>, a frame flagged for review.
            </li>
            <li>
              <i>Playback framerate</i> sets the playback speed and the number of frames
              skipped per scroll notch.
            </li>
            <li>
              <b>CVAT project</b> opens the experiment's CVAT project (named after the
              experiment) in a new tab. <b>Frame in CVAT</b> opens the displayed frame in its
              CVAT job; it is grayed out when the frame is not one of the frames selected for
              CVAT validation. <i className="fa fa-refresh" /> reloads the list after new tasks are uploaded.
            </li>
          </ul>

          <h3>ROIs &amp; segmentation</h3>
          <p>
            The card under Navigation lists the idtrackerai settings of the experiment:
            the configuration stored in the database, <code>&lt;date&gt;.toml</code>,{' '}
            <code>landmarks.toml</code> and <code>&lt;date&gt;.conf</code> (those present), with
            their intensity and area thresholds and number of animals. The files are only read here, never changed.
          </p>
          <ul>
            <li>Tick a source in the <b>ROIs</b> column to draw its ROIs on the frame in that colour. A dashed ROI is cut out of the mask; numbers mark the ROIs of a source with several (landmarks).</li>
            <li>Click a source's name to list its ROIs.</li>
            <li>
              Pick a source in the <b>Segment</b> column to segment every displayed frame with its
              settings, as idtrackerai would. Blobs are filled in green, and the number of blobs and their
              areas are shown under the table (in red when it differs from the number of animals).
              This works for experiments without database too, to check the settings before tracking.
              Background subtraction and resolution reduction are not applied in the preview.
            </li>
            <li>Both choices are kept when you open another experiment. <i className="fa fa-refresh" /> reads the files again.</li>
          </ul>
        </Section>

        <Section id="help-pe" title="Proboscis extension (PE)">
          <p>
            The pose pipeline finds candidate <b>bouts</b> where a fly may extend its
            proboscis. Bouts close in time are grouped into <b>bursts</b>. Here you watch
            each burst and say what each bout really is.
          </p>

          <h3>Layout</h3>
          <ul>
            <li>
              <b>Top card:</b> pick a burst. It has previous / next burst, jumps to the next
              unlabeled burst, and lets you go to a burst id or position. <i>Find PE near</i>{' '}
              selects the PE bout closest to a ZT time or frame number. <i>⤓ video</i>{' '}
              records the burst view to a file.
            </li>
            <li>
              <b>Media:</b> the burst clip with the pose drawn on top (untick <i>pose</i> to
              hide it), the pose alone on white, and two traces: proboscis distance and pose
              confidence. A vertical line follows the video.
              Drag on a trace to scrub the video.
            </li>
            <li>
              <b>Bouts table:</b> one row per bout of the burst. Click a row (or use{' '}
              <Key>↑</Key>/<Key>↓</Key>) to select it.
            </li>
            <li>
              <b>Current media</b> (right): the files loaded for this burst, useful when a
              video or trace is missing.
            </li>
          </ul>
          <p className="help-note">
            Drag the bar under the media to give it more or less height, and the bar left
            of <i>Current media</i> to resize that panel. Double click either bar to reset it.
          </p>

          <h3>Giving verdicts</h3>
          <p>
            Each bout gets one of <b>pe, feed, groom, walk, other, merge, unsure</b>. Verdicts
            are saved as soon as you click.
          </p>
          <ul>
            <li>
              <b>★</b> marks the pipeline's prediction. Until you choose, that button is
              shown in <span className="help-pending">yellow italics</span>: it is the
              default, but not confirmed by a person.
            </li>
            <li>Clicking the selected verdict again removes it.</li>
            <li>The dashed buttons of the first row give the same verdict to every bout of the burst.</li>
            <li><i>pred:</i> shows the raw pipeline label, even after you annotate.</li>
          </ul>

          <h3>Ground-truth segmentation</h3>
          <p>
            To mark the true start and end of events, <Key>Shift</Key>+drag on the distance
            trace. Click a green bar to delete it. <i>seg: hidden</i> hides the automatic
            segmentation so it does not bias you. When the window is complete, tick{' '}
            <i>segmentation done</i>.
          </p>

          <h3>Audit mode</h3>
          <p>
            Goes through the bursts listed in the audit file (<code>PE_AUDIT_CSV</code> on
            the server, all flies), in its order, switching fly as needed. It shows how
            many are done, and <Key>k</Key>/<Key>j</Key> jump to the next / previous one
            still to review. Without audit mode, bursts are sorted by score or, with{' '}
            <i>sort chronologically</i>, by time.
          </p>

          <h3>Starting over</h3>
          <p>
            <i>Delete human annotations…</i> (top right of the tab) removes every verdict and
            ground-truth segment entered for the loaded experiment. You must type the
            experiment name to confirm. The rows are first saved to a backup file next to the
            database. The automatic segmentation is kept.
          </p>
        </Section>

        <Section id="help-ethogram" title="Ethograms">
          <p>
            Shows one fly's behaviour over the whole experiment, below a movie of the fly.
            The cursor, the movie and the fly's row of the tracking table stay in sync.
          </p>
          <ul>
            <li>Choose the fly in the list, with ◀ ▶, or with <Key>↑</Key>/<Key>↓</Key>. Flies without an ethogram are marked.</li>
            <li>
              One row per behavior: walk, groom, feed, inactive + micromovement and inactive
              (<i>inactive + PE</i> and <i>inactive + rejection</i> count as inactive; unclassified
              seconds are left blank). Zoomed out, the shade of a row is the share of time spent in
              that behavior, so even a single second shows faintly; zoomed in, each second is a block.
              The % next to each behavior is its share of the visible window. Hover for the bout under
              the pointer (start, end, duration, score).
            </li>
            <li>
              Zoom with the wheel, the window buttons (1 min … 6 h, All), <Key>+</Key>/<Key>−</Key> or a
              double click; pan by dragging, Shift+wheel, or by dragging the window on the
              <i>Whole recording</i> strip. The window keeps its width while the movie plays, when
              you jump and when you switch flies.
            </li>
            <li>Click the ethogram or use <Key>←</Key>/<Key>→</Key> to move the cursor.</li>
            <li>◀ ▶ next to a behavior jump to the start of its previous / next bout; <i>skip bouts under</i> ignores shorter ones.</li>
            <li><i>follow playback</i> moves the window along with the playing movie; <i>shade by score</i> fades seconds the classifier was less sure about.</li>
            <li><i>Go to</i> jumps to a frame number or a ZT time.</li>
            <li><i>Open frame in viewer</i> shows the cursor's frame in the Group viewer; <i>Open frame in Pose</i> shows this fly's pose at that frame in the Pose tab.</li>
            <li><b>← sleep bout / sleep bout →</b> jump between sleep bouts.</li>
          </ul>

          <h3>Sleep bout videos</h3>
          <ul>
            <li><i>Capture sleep bout video</i> downloads the bout under the cursor, or the next one if the fly is awake.</li>
            <li><i>Capture all sleep bouts</i> makes one video per bout of the fly. Progress shows in the console.</li>
            <li>
              With <i>save on server</i>, videos are written to{' '}
              <code>&lt;experiment&gt;/flyhostel/videos/&lt;fly&gt;/</code> instead of being
              downloaded. Saved videos appear as buttons that jump to each bout.
            </li>
          </ul>

          <h3>DEG labels (training data for the behavior classifier)</h3>
          <ul>
            <li>
              The <i>DEG labels</i> strip under the ethogram shows the fly's labels in its deepethogram
              project (<code>FlyHostel_deepethogram</code> for 150 fps recordings, <code>…_47fps</code>{' '}
              otherwise), the labels the classifier is trained on. Yellow = a second whose frames carry
              different labels (e.g. labelled frame by frame in the DEG GUI).
            </li>
            <li>
              Select seconds with <Key>Shift</Key>+drag on the ethogram, or with <Key>[</Key>/<Key>]</Key>{' '}
              at the cursor; without a selection the buttons and keys label the cursor's second. A preset
              (keys <Key>1</Key> <i>walk</i>, <Key>2</Key> <i>groom</i>, <Key>3</Key> <i>feed</i>,{' '}
              <Key>4</Key> <i>inactive + micromovement</i>, <Key>5</Key> <i>inactive</i>,{' '}
              <Key>6</Key> <i>inactive + PE</i>, <Key>0</Key> <i>background</i>) or a custom set of columns is set to 1 and
              every other column to 0 for all frames of those seconds; <i>None (remove)</i>{' '}
              (<Key>Delete</Key>) sets them back to not labelled (-1), removing whatever was written there.
            </li>
            <li>
              <b>● Label while moving</b> gives every second the cursor enters (playing the movie, <Key>←</Key>/<Key>→</Key>)
              the last label applied, shown next to the buttons; a label key switches it on the fly. With{' '}
              <i>None</i> as the last label, it removes the labels of the seconds it passes instead. A jump of up to 10 s
              forward (fast playback, Shift+<Key>→</Key>) also labels the seconds in between; clicking elsewhere labels only the
              second reached. <b>■ Stop labelling</b> turns it off (so does switching fly).
            </li>
            <li>
              <b>↶ Undo</b> (<Key>Ctrl</Key>+<Key>Z</Key>) restores the frames the last label applied had
              replaced (hover the button to see which); press it again to go further back. Each label
              applied is one step; with <i>Label while moving</i>, everything painted with a label is
              part of that label's step, so one undo removes the whole stretch (and stops labelling while
              moving). Undo is kept by the server until it restarts, and refuses when those frames were
              changed elsewhere (e.g. in the deepethogram GUI) since. A DEG folder made for a label stays,
              with its frames back to not labelled.
              <b>↷ Redo</b> (<Key>Ctrl</Key>+<Key>Y</Key> or <Key>Ctrl</Key>+<Key>Shift</Key>+<Key>Z</Key>)
              writes the last undone step again, until a new label is applied.
            </li>
            <li>
              Labels go to <code>&lt;chunk&gt;_labels.csv</code> of the fly's video folder of each chunk
              (<code>DATA/&lt;experiment&gt;_&lt;chunk&gt;_&lt;local identity&gt;/</code>). A chunk without
              folder gets one made with deepethogram from its single-animal video, which takes ~30 s;
              its progress shows in the console, and the labels are written when it is done.
            </li>
          </ul>
        </Section>

        <Section id="help-qc" title="QC">
          <p>
            How many frames of the loaded experiment do <b>not</b> track the expected number of
            flies. A frame is ok when the tracking table (<code>IDENTITY</code>, or{' '}
            <code>IDENTITY_VAL</code> with <i>Validated tracking</i>) has exactly one row per fly,
            each with its own non-zero identity. With a single fly, identity 0 is the fly
            (flyhostel's convention), so one row of any identity is ok. Every recorded frame between the first and the
            last tracked chunk is checked, so frames without any row count too. The first visit
            for an experiment (and table) reads the whole table in the background (~0.1 s per
            chunk, progress in the console); the result is kept until the database changes, and{' '}
            <i>Recompute</i> reads it again.
          </p>
          <ul>
            <li><b>Unidentified</b> (groups only): a fly is there but has identity 0.</li>
            <li><b>Not detected</b>: fewer flies than expected and none without identity.</li>
            <li><b>Other</b>: extra rows, or the same identity twice.</li>
          </ul>
          <p>
            The chart shows the share of bad frames per chunk (the strip below it: per 10 s).
            A red ▲ marks a chunk boundary where a fly is not identified on the last frame of
            one chunk or on the first frame of the next: the concatenation links identities
            across chunks through those frames, so a fly missed there can leave later chunks
            without its identity (<i>unidentified</i>) or, with a single fly, without its rows. The <i>Chunks</i> table lists the
            chunks with problems, how many flies are identified on their first / last frame and
            the CONCATENATION rows flagged as broken. Click a bar, a strip bin, a chunk or a frame
            number to open it in the Group viewer.
          </p>
          <h3>Pose</h3>
          <p>
            Below, the quality of each fly's pose (SLEAP), read from its pose file
            (<code>motionmapper/NN/pose_raw/…h5</code>) in the background the first time (~20 s per
            fly; a missing pose file is compiled from the chunks only when you press{' '}
            <i>Recompute pose QC</i>, which takes minutes). Per frame:
          </p>
          <ul>
            <li><b>Body parts detected</b>: how many of the 12 scored parts SLEAP found (confidence ≥ 0.2). The leg joints (<code>*LJ</code>, <code>*RJ</code>) are shown but not scored.</li>
            <li><b>Confidence</b>: the mean confidence of the parts found.</li>
            <li><b>Pose score</b>: the sum of the confidences of the parts found (SLEAP's instance score) divided by 12, so 1 = every part found with full confidence. Frames below 0.5 count as <i>poor</i> and are drawn in red.</li>
          </ul>
          <p>
            Click a fly in the table to show its charts: per-chunk means of the three measures
            (the strips below them: per 10 s), how often each body part is detected per chunk,
            the distributions per frame and the worst 10 s bins. Clicking any of them opens that
            frame of the fly in the Pose tab. The proboscis is normally retracted, so it is
            rarely detected.
          </p>
        </Section>

        <Section id="help-pose" title="Pose">
          <p>
            One fly at a time: the frame cropped around it (<i>Zoom</i>: in squares of the pose;
            dashed: the square SLEAP saw) with its body parts coloured by confidence (green ≥ 0.8,
            orange 0.5–0.8, red &lt; 0.5). Hover a part, or its row in the table, to see its
            name, confidence and position (frame pixels). The table lists every part, also the
            ones not detected, with the frame's parts detected, confidence, pose score and the
            instance score stored by SLEAP. <i>Frames around</i> plots the three measures for
            every frame within the window (± 2, 10 or 60 s); click to go to a frame. The
            buttons move by a chunk, 1 s, 10 or 1 frames; <i>Open in Group viewer</i> shows the
            same frame there; <i>Open in Ethograms + Group viewer</i> opens this fly's ethogram at
            that frame and moves the Group viewer to it as well (grayed out when the fly has no
            ethogram). A fly without a position in a frame (not tracked) has its pose
            listed but not drawn. After the pose pipeline ran again for a fly, <i>Recompile
            pose</i> builds its pose file again from the chunks' predictions (about a minute;
            progress in the console); next to it, when the current file was compiled.
          </p>
        </Section>

        <Section id="help-overview-tab" title="Metadata overview">
          <p>
            A dashboard of every experiment listed in <code>index.txt</code>, built from the
            <code>ethoscope_metadata</code> of each database (one row per fly). It does not
            depend on the loaded experiment. The first visit reads all databases (a few
            seconds); <i>Refresh</i> reads them again.
          </p>
          <ul>
            <li>
              <b>Find experiments</b> answers questions like "how many experiments have a fly of
              genotype A living with flies of genotype B, recorded between two dates?": pick a
              <i>Genotype</i>, who it is <i>living with</i> (a genotype of at least one other fly of
              the same experiment, <i>no one (isolated)</i> for a fly alone in its experiment, or
              <i>only its own genotype</i>) and a date range. Once a genotype is chosen, a second list
              next to it narrows to experiments with exactly that many flies of it (e.g. 1
              iso31xmz19 living with 1 nAChRalpha4rye). Any of them can be left empty. The number of matching experiments is shown below, and every chart and
              the table are restricted to them. Each list shows only the choices that still give
              results, with their number of experiments.
              <i>Analyzed</i> and <i>Validated</i> (any / only / exclude) keep or drop the experiments
              with a database, and the validated ones: with <code>_VAL</code> tables, or with a single
              fly (those are never validated, their tracking is final). <i>DEG labels</i> does the same for
              experiments where at least one fly has labelled frames in a deepethogram project (the
              ground truth ethograms, e.g. made in the Ethograms tab); the <i>DEG</i> column of the
              table counts those videos (one per chunk of a fly).
            </li>
            <li>
              <i>Cohoused with (other genotypes)</i> is the genotypes of the other flies of a fly's
              experiment, other than its own; cross-tabulate it with <i>Genotype</i> to see every mix.
            </li>
            <li>
              <b>Not analyzed experiments.</b> Experiments in the metadata sheets (the CSV exports in
              <code>/flyhostel_data/metadata</code> of the sheets listed in the googleapi config) that
              have a folder in the videos directory but no database yet are shown too, marked
              <i>not analyzed</i>. Use the <i>Analyzed</i> toggle of <i>Find experiments</i> or chart to show or
              hide them; their metadata comes from the sheet instead of the database.
              <i>Download metadata sheets</i> downloads those CSV exports again
              (<code>download_metadata_sheets</code>, in the background) and reloads the dashboard;
              databases are not changed.
            </li>
            <li>
              <i>Rebuild index</i> rewrites <code>index.txt</code> with every database now in the videos
              folder (same as <code>find -L -maxdepth 4 -mindepth 4 -regex .*FlyHostel.*db -not -name index.db</code>),
              in the background, and reloads the dashboard. Progress shows in the console.
            </li>
            <li>
              <b>Fixing metadata.</b> After correcting a sheet (e.g. a light cycle written in the wrong
              column), click <i className="fa fa-cloud-download" /> next to the experiment (experiments
              table or light cycle list). It downloads that experiment's rows from the sheets
              (<code>download_flyhostel_metadata</code>, ~10 s) and shows them with checks: one row
              per animal, FlyHostel number / date / time matching the experiment, identities present
              and unique, genotype filled in, light cycle encoding. Changed cells are highlighted
              (hover for the current value), and the rows are also printed in the console. Nothing is
              written until <i>Write to database</i>; failed checks (✗) must be confirmed first. The
              old metadata is saved in <code>&lt;experiment&gt;/metadata_backups/</code>.
            </li>
            <li>
              <i>Predownload sheet metadata</i> (experiments table) downloads the sheet rows of every
              experiment in the table at once (about 30 s for all of them) and compares them with each
              database, without writing anything. The <i>Sheet</i> column then says what would change:
              <i>✗ check failed</i>, <i>changes</i> (a key value such as genotype, identity or light
              cycle differs, or the number of rows), <i>fills empty cells</i> (key values only appear
              where the database had none, e.g. light cycle), <i>minor changes</i> (other columns) or
              <i>= same</i>; hover for details and sort by it. The ☁ button then opens at once with the
              predownloaded rows; <i>Download again</i> in the dialog fetches them anew (after editing
              the sheet). Predownloads are kept until the server restarts.
            </li>
            <li><i>Count</i> switches every chart between experiments and flies.</li>
            <li>
              <b>Click a bar to filter</b> on that value; click more bars to add values.
              Whenever a search, a <i>Find experiments</i> query (kept between visits) or a bar filter
              is on, a blue banner above the charts says how many experiments they hide (and whether the
              loaded one is among them), with one chip per restriction (click one to remove it) and{' '}
              <i>Clear all</i>. A chart
              ignores its own filter, so the other values of that property stay visible.
            </li>
            <li>
              A fly-level filter keeps the matching flies and the experiments with at least
              one of them: the table shows <i>(n match)</i> when only some flies of an
              experiment do.
            </li>
            <li><i>Add chart</i> lists every metadata column found, with the share of flies that have a value; × removes a chart.</li>
            <li><i>Cross-tabulation</i> counts two properties against each other (e.g. genotype × group size).</li>
            <li>
              <i>Open</i> in the experiments table loads that experiment in the Group viewer. The
              loaded experiment's row is highlighted with a <i>loaded</i> badge, and the table scrolls
              to it when the tab is shown; <i className="fa fa-crosshairs" /> <i>Loaded experiment</i>{' '}
              scrolls back to it (or says which search, query or filter hides it).
            </li>
            <li><i>CSV</i> downloads one row per matching fly with all metadata columns.</li>
          </ul>
          <p className="help-note">
            Values are shown as written in the metadata sheets: <code>FEM</code> and <code>VFEM</code>,
            or <code>NO</code> and <code>N</code>, are separate values. Empty cells, <code>NONE</code>
            and <code>nan</code> count as <i>(missing)</i>.
          </p>
          <p>
            <b>Light cycle.</b> Depending on the metadata sheet, the light cycle (LD, DD, LL) was
            written in <code>light_cycle</code>, <code>condition</code>, <code>experiment</code> or at the
            end of <code>vial</code>. <i>Light cycle (merged)</i> gathers them; <i>Light cycle recorded in</i>
            says from which column. A fly without one takes its group's. Experiments not using
            <code>light_cycle</code> are listed under <i>Non-standard light cycle encoding</i> and marked ⚠
            in the experiments table. Only the dashboard is affected: the databases are unchanged.
          </p>
        </Section>

        <Section id="help-data" title="Data management">
          <p>
            Every experiment folder in the videos drives, with the space it takes and whether its
            critical files are in <code>/flyhostel_data/backup</code> (copied there by flyhostel's backup
            script: database, index.db, metadata.yaml, landmarks, configs, raw chunks 0–399, pose of the
            chunks among those that the database tracks, motionmapper outputs, interactions, PE traces and validation files).
          </p>
          <ul>
            <li><i>Backup</i>: <b>backed up</b> = every critical file has a copy of the same size that is not
              older; <b>outdated</b> = some changed since (e.g. the database); <b>incomplete</b> = some have no
              copy; <b>no backup</b> = no folder in the backup. ▸ lists the files concerned.</li>
            <li><i>Not in backup</i>: space taken by files with no identical copy, critical or not (chunks from
              400 on, idtrackerai sessions, motionmapper movies, …). They are lost on delete.</li>
            <li><b>⚠ gaps</b>: the chunks tracked in the database, or the raw chunks, are not consecutive.
              This is a serious problem; ▸ lists the missing chunks and <i>Backup: ⚠ chunk gaps</i> filters them.</li>
            <li><i>Dropbox index</i>: listed in <code>FlyHostel&lt;N&gt;_dropbox_index.txt</code> of the videos
              folder, a snapshot that may be old.</li>
            <li>The table shows the last scan. <i>Scan all</i> walks every folder again in the background
              (several minutes); ↻ rescans one experiment.</li>
            <li><i>Delete</i> is only enabled for backed-up experiments that are not loaded. You type the
              experiment name to confirm; the server scans it again, deletes the folder (the backup is not
              touched) and removes its database from <code>index.txt</code>.</li>
          </ul>
          <h3>Files on Dropbox</h3>
          <p>
            Lists every file of a folder on Dropbox (☁ in a row of the table, or type a folder relative to{' '}
            <code>dropbox:/Data/flyhostel_data/videos</code> and press <i>List</i>), next to its local copy:
            <b> same size</b>, <b>verified</b> (contents hashed earlier), <b>different size / content</b>,{' '}
            <b>no local copy</b>. The pattern selects the files, as a <i>Glob</i> (<code>*.slp</code>: any
            file name ending in .slp, in any subfolder; with a <code>/</code> the whole path, e.g.{' '}
            <code>flyhostel/**/*.slp</code>; <code>?</code> one character, <code>[0-4]</code> a set) or a{' '}
            <i>Regex</i> (JavaScript, searched in the path in the folder, e.g.{' '}
            <code>^000[0-4]\d\d\.(mp4|npz)$</code>), together with <i>Local copy</i>; the counts cover every
            match, the table shows the first 1000.
          </p>
          <p>
            <i>Delete N on Dropbox</i> deletes the selected files that have a local copy of the same size; you type
            the number of files to confirm. The server hashes each local copy first and deletes a file only when
            its Dropbox content hash matches and neither copy changed meanwhile; the others are kept and listed in
            the console. Local copies are never touched. Deleted files can be restored from Dropbox's deleted files
            for a while and are logged to <code>~/.cache/idtrackerai-validator/deleted_from_dropbox.jsonl</code>.
          </p>
          <p>
            Untick <i>Safe mode</i> (ticked again on every page load) to delete files Dropbox does not need to keep at
            all: the button then deletes every matching file, also those with no or another local copy, without
            hashing anything. The dialog says how many of them have no local copy of the same size.
          </p>
          <h3>Restore from Dropbox</h3>
          <p>
            Experiments deleted here are still on Dropbox (<code>dropbox:/Data/flyhostel_data/videos</code>).
            The card below the table lists the experiment folders that are on Dropbox but not in the videos
            drives, with the deepethogram (DEG) videos made from them (<i>DEG labelled</i>: videos with a
            labels CSV, in <code>/flyhostel_data/fiftyone/FlyBehaviors/DEG*/*/DATA</code>; hover for the projects).
          </p>
          <ul>
            <li><i>List Dropbox</i> lists Dropbox and the DEG projects again (~30 s) and inspects the candidates with
              labelled DEG videos: size, raw chunks and whether the database is there. ⓘ inspects another one.</li>
            <li><i>Show</i>: only the experiments with labelled DEG videos (default), with any DEG video, or all.</li>
            <li><i>Restore</i> (one row, or the checked rows) shows how much each drive receives and keeps free,
              then copies the experiments with rclone (one at a time per drive; progress in the console). Each one
              lands in its usual folder, its database is added to <code>index.txt</code> (it then appears in the
              experiment picker) and it is scanned. The server refuses when a drive would keep less than 50 GB free.</li>
            <li><b>partial</b>: an earlier restore stopped half way; restoring again resumes it, copying only the
              missing files. <b>in backup</b>: its critical files are also in the local backup.</li>
          </ul>
        </Section>

        <Section id="help-monitor" title="Monitor">
          <p>
            What the nextflow pipelines of this computer are doing: <b>idtrackerai</b>{' '}
            (<code>idtrackerai_v3</code>), <b>pose estimation</b> and <b>behavior prediction</b>, each a folder of{' '}
            <code>vsc-scripts/nextflow/pipelines</code> with a CSV of experiments (<code>idtrackerai.csv</code>,{' '}
            <code>videos.csv</code>, <code>animals.csv</code>). Refreshed every 10 s while shown (<i>Auto refresh</i>).
          </p>
          <ul>
            <li><b>running</b>: a nextflow run is going on in the folder. Its tasks per process (done / cached /
              running / failed) come from the folder's <code>.nextflow.log</code>; each task is matched to its
              experiment from its script. Failed tasks are listed with their work dir.</li>
            <li><i>In this run</i>: the CSV rows of the running batch, with their tasks and what runs now.{' '}
              <b>still marked 1</b>: the run processes it but its row lost the batch stamp (the CSV was saved
              over, e.g. by an editor with the old version open), so the queue will take it again.{' '}
              <b>complete</b> (pose estimation): listed in <code>completed/&lt;batch&gt;.txt</code>; its flies are then
              added to <code>animals.csv</code> marked 1.</li>
            <li><b>Behavior prediction, per fly</b> (from its files on disk): <b>done</b> = its ethogram figure and sleep
              were written by this batch (the last steps); <b>explorable</b> = its behavior predictions were written by this
              batch, so the Ethograms tab already shows them; <b>pending</b> = not yet. The boxes are its outputs in pipeline
              order (pose, movie, pe, behavior, sleep, ethogram): filled = written by this batch, outlined = an older output,
              dashed = missing; hover for the time. <i>Ethogram</i> / <i>Pose</i> load the experiment (unless loaded) and show the
              fly in that tab. In <i>Recent batches</i> the identities are coloured the same way.</li>
            <li><i>Queued</i>: rows marked 1. With a queue (<code>nohup ./run_queue.sh &gt; run_queue.log 2&gt;&amp;1 &amp;</code>{' '}
              in the pipeline folder; pose estimation and behavior prediction) they start, in this order, when the
              current run ends: <i>queue stopped</i> means no <code>run_queue.sh</code> is running there.
              idtrackerai has no queue: its rows marked 1 are those of the run started by hand.</li>
            <li><b>Relaunch failed tasks</b> (pose estimation, behavior prediction): nextflow ignores failed tasks, so a run
              ends normally and their fly / experiment just stops there. For every batch whose last run had failures, and whose
              rows were not re-queued since, it lists each failed task with the error it ended on and the deepest frame of our
              own code (▸ for the end of its <code>.command.err</code>), with the time it failed next to its work dir (to tell
              failures before a fix from those after it). When they all failed with the same error, fix that
              first: relaunching would fail the same way. Then press <b>Re-queue</b>: it marks their rows 1 again (as <code>run_queue.sh</code> expects, under its lock) so the
              queue takes them in its next round; with a same-cause warning it asks for a second click. Or copy{' '}
              <i>Run batch … again now</i> (<code>nextflow run … -resume &lt;session&gt; --batch …</code>) into a terminal, only
              when no run is going on in the folder (not started from the app: a run started by the server would stop with it).
              Both resume the nextflow session: what completed before is reused from the cache.</li>
            <li><i>Recent batches</i>: the last batch stamps of the CSV; <i>run_queue.log</i>: its last lines.</li>
            <li><i>Open</i> loads the experiment in the viewer.</li>
          </ul>
        </Section>

        <Section id="help-keys" title="Keyboard & mouse">
          <p className="help-note">Shortcuts are ignored while you type in a text box.</p>
          <div className="help-keys-grid">
            {SHORTCUTS.map(([group, rows]) => (
              <table key={group} className="help-keys">
                <caption>{group}</caption>
                <tbody>
                  {rows.map(([keys, what], i) => (
                    <tr key={i}><td>{keys}</td><td>{what}</td></tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </Section>

        <Section id="help-glossary" title="Glossary">
          <dl className="help-glossary">
            <dt>Frame number</dt>
            <dd>Frames counted from the start of the recording (chunk 0).</dd>
            <dt>Chunk</dt>
            <dd>The recording is stored in chunks of fixed length (usually 5 min); <i>Frm idx</i> is the frame within its chunk.</dd>
            <dt>ZT</dt>
            <dd>Zeitgeber time: time since lights-on (ZT0) of the first day. ZT seconds keep counting on later days.</dd>
            <dt>Identity</dt>
            <dd>The fly number idtrackerai assigns for the whole experiment. 0 means not identified.</dd>
            <dt>Local identity / fragment</dt>
            <dd>idtrackerai's identity within one chunk, and the stretch of frames where a fly was followed without ambiguity.</dd>
            <dt>Rejection</dt>
            <dd>A frame flagged for review by the interaction analysis.</dd>
            <dt>Validated tracking</dt>
            <dd>Tables corrected after review (<code>_VAL</code> suffix), as opposed to the raw tracking.</dd>
            <dt>Bout / burst</dt>
            <dd>A candidate proboscis extension, and a group of bouts close in time.</dd>
          </dl>
        </Section>
      </div>
    </div>
  );
}
