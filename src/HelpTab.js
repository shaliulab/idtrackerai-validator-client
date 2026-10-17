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
  { id: 'help-overview-tab', title: 'Overview' },
  { id: 'help-data', title: 'Data management' },
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
    [<><Key>Ctrl</Key>+<Key>1</Key> / <Key>2</Key> / <Key>3</Key> / <Key>4</Key> / <Key>5</Key> / <Key>6</Key></>, 'Switch to Group viewer / PE / Ethograms / Overview / How to use / Data management'],
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
            <li><b>see which experiments exist</b>, by genotype, group size, sex and any other metadata (Overview);</li>
            <li><b>free disk space</b> by deleting experiments that are backed up (Data management).</li>
          </ul>
          <p className="help-note">
            Each tab name shows its shortcut (<Key>Ctrl</Key>+<Key>1</Key>…<Key>6</Key>).
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
              blobs; the PE and Ethograms tabs are grayed out for them.
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
            genotype, idtrackerai details (local identity, fragment, area) and the ZT time.
            You can type a frame number or chunk into the first columns to jump there.
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
            Shows one fly's behaviour over the whole experiment, next to a movie of the fly.
            The cursor, the movie and the fly's row of the tracking table stay in sync.
          </p>
          <ul>
            <li>Choose the fly in the list, with ◀ ▶, or with <Key>↑</Key>/<Key>↓</Key>. Flies without an ethogram are marked.</li>
            <li>Click the plot or use <Key>←</Key>/<Key>→</Key> to move the cursor.</li>
            <li><i>Go to</i> jumps to a frame number or a ZT time.</li>
            <li><i>Open frame in viewer</i> shows the cursor's frame in the Group viewer.</li>
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
        </Section>

        <Section id="help-overview-tab" title="Overview">
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
            </li>
            <li>
              <i>Cohoused with (other genotypes)</i> is the genotypes of the other flies of a fly's
              experiment, other than its own; cross-tabulate it with <i>Genotype</i> to see every mix.
            </li>
            <li>
              <b>Not analyzed experiments.</b> Experiments in the metadata sheets (the CSV exports in
              <code>/flyhostel_data/metadata</code> of the sheets listed in the googleapi config) that
              have a folder in the videos directory but no database yet are shown too, marked
              <i>not analyzed</i> (they cannot be opened). Use the <i>Analyzed</i> chart to show or
              hide them; their metadata comes from the sheet instead of the database.
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
              Filters show as chips above the charts (click one to remove it). A chart
              ignores its own filter, so the other values of that property stay visible.
            </li>
            <li>
              A fly-level filter keeps the matching flies and the experiments with at least
              one of them: the table shows <i>(n match)</i> when only some flies of an
              experiment do.
            </li>
            <li><i>Add chart</i> lists every metadata column found, with the share of flies that have a value; × removes a chart.</li>
            <li><i>Cross-tabulation</i> counts two properties against each other (e.g. genotype × group size).</li>
            <li><i>Open</i> in the experiments table loads that experiment in the Group viewer.</li>
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
            script: database, index.db, metadata.yaml, landmarks, configs, raw chunks 0–399, pose of those
            chunks, motionmapper outputs, interactions, PE traces and validation files).
          </p>
          <ul>
            <li><i>Backup</i>: <b>backed up</b> = every critical file has a copy of the same size that is not
              older; <b>outdated</b> = some changed since (e.g. the database); <b>incomplete</b> = some have no
              copy; <b>no backup</b> = no folder in the backup. ▸ lists the files concerned.</li>
            <li><i>Not in backup</i>: space taken by files with no identical copy, critical or not (chunks from
              400 on, idtrackerai sessions, motionmapper movies, …). They are lost on delete.</li>
            <li><i>Dropbox index</i>: listed in <code>FlyHostel&lt;N&gt;_dropbox_index.txt</code> of the videos
              folder, a snapshot that may be old.</li>
            <li>The table shows the last scan. <i>Scan all</i> walks every folder again in the background
              (several minutes); ↻ rescans one experiment.</li>
            <li><i>Delete</i> is only enabled for backed-up experiments that are not loaded. You type the
              experiment name to confirm; the server scans it again, deletes the folder (the backup is not
              touched) and removes its database from <code>index.txt</code>.</li>
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
