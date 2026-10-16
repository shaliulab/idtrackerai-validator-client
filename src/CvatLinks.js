// Group viewer buttons opening the loaded experiment in CVAT: its project, and
// the displayed frame when it is one of the frames selected for validation.
// /api/cvat lists every selected frame once per experiment, so following the
// displayed frame costs no request.
import React, { useCallback, useEffect, useState } from 'react';
import api from './api';

function CvatLinks({ experiment, frameNumber }) {
  const [index, setIndex] = useState(null);     // /api/cvat response
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchIndex = useCallback(async (refresh = false) => {
    if (!experiment) { setIndex(null); return; }
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/api/cvat${refresh ? '?refresh=1' : ''}`);
      setIndex(data);
    } catch (err) {
      setIndex(null);
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [experiment]);

  useEffect(() => { fetchIndex(); }, [fetchIndex]);

  const project = index?.projects?.[0];
  const hit = index?.frames?.[frameNumber];    // [task, job, task frame]
  const open = (path) => window.open(`${index.base_url}${path}`, '_blank', 'noopener');

  let projectTitle;
  if (loading) projectTitle = 'Looking for the CVAT project…';
  else if (error) projectTitle = `CVAT lookup failed: ${error}`;
  else if (index && !index.configured) projectTitle = 'CVAT is not configured on the server (CVAT_HOST, CVAT_USERNAME, CVAT_PASSWORD)';
  else if (!project) projectTitle = `No CVAT project named ${index?.experiment ?? 'after this experiment'}`;
  else {
    projectTitle = `Open CVAT project ${project.name} (${project.tasks} task${project.tasks === 1 ? '' : 's'})`;
    if (index.projects.length > 1) {
      projectTitle += `. Also: ${index.projects.slice(1).map((p) => p.name).join(', ')}`;
    }
  }

  const frameTitle = hit
    ? `Open frame ${frameNumber} in CVAT (task ${hit[0]}, job ${hit[1]}, frame ${hit[2]})`
    : project
      ? `Frame ${frameNumber} is not one of the ${Object.keys(index.frames).length} frames selected for CVAT validation`
      : projectTitle;

  return (
    <div className="toolbar" style={{ justifyContent: 'center' }}>
      <button disabled={!project} title={projectTitle} onClick={() => open(`/projects/${project.id}`)}>
        <i className={`fa ${loading ? 'fa-spinner fa-spin' : 'fa-external-link'}`} style={{ marginRight: 6 }} />
        CVAT project
      </button>
      <button disabled={!hit} title={frameTitle}
              onClick={() => open(`/tasks/${hit[0]}/jobs/${hit[1]}?frame=${hit[2]}`)}>
        <i className="fa fa-crosshairs" style={{ marginRight: 6 }} />
        Frame in CVAT
      </button>
      <button className="icon-btn" disabled={loading || !experiment} title="Reload the CVAT project and its selected frames"
              onClick={() => fetchIndex(true)}>
        <i className="fa fa-refresh" />
      </button>
    </div>
  );
}

export default CvatLinks;
