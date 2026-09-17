import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWorkspaceNavigation,
  normalizeWorkspaceStage,
  readWorkspaceNavigation,
  resolveWorkspaceNavigation,
  writeWorkspaceNavigation
} from './workspaceNavigationState.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

test('persists and restores Costos navigation for the same user and organization', () => {
  const storage = createStorage();
  writeWorkspaceNavigation(storage, 'user-1', 'org-1', {
    module: 'project-workspace',
    activeProjectId: 'project-1',
    selectedProjectStage: 'costos'
  });
  assert.deepEqual(readWorkspaceNavigation(storage, 'user-1', 'org-1'), {
    module: 'project-workspace',
    activeProjectId: 'project-1',
    selectedProjectStage: 'costos'
  });
});

test('persists Cuantificación and Evidencia stages', () => {
  const storage = createStorage();
  for (const stage of ['cuantificacion', 'evidencia']) {
    writeWorkspaceNavigation(storage, 'user-1', 'org-1', {
      module: 'project-workspace',
      activeProjectId: 'project-1',
      selectedProjectStage: stage
    });
    assert.equal(readWorkspaceNavigation(storage, 'user-1', 'org-1').selectedProjectStage, stage);
  }
});

test('invalid stage falls back to Evidencia', () => {
  const storage = createStorage();
  writeWorkspaceNavigation(storage, 'user-1', 'org-1', {
    module: 'project-workspace',
    activeProjectId: 'project-1',
    selectedProjectStage: 'unknown'
  });
  assert.equal(readWorkspaceNavigation(storage, 'user-1', 'org-1').selectedProjectStage, 'evidencia');
  assert.equal(normalizeWorkspaceStage('invalid'), 'evidencia');
});

test('navigation is isolated by user and organization', () => {
  const storage = createStorage();
  writeWorkspaceNavigation(storage, 'user-1', 'org-1', {
    module: 'project-workspace',
    activeProjectId: 'project-1',
    selectedProjectStage: 'costos'
  });
  assert.equal(readWorkspaceNavigation(storage, 'user-2', 'org-1'), null);
  assert.equal(readWorkspaceNavigation(storage, 'user-1', 'org-2'), null);
});

test('logout clears navigation and prevents workspace restoration', () => {
  const storage = createStorage();
  writeWorkspaceNavigation(storage, 'user-1', 'org-1', {
    module: 'project-workspace',
    activeProjectId: 'project-1',
    selectedProjectStage: 'costos'
  });
  clearWorkspaceNavigation(storage, 'user-1', 'org-1');
  assert.equal(readWorkspaceNavigation(storage, 'user-1', 'org-1'), null);
});

test('inaccessible project falls back safely to Projects and Evidencia', () => {
  const result = resolveWorkspaceNavigation({
    module: 'project-workspace',
    activeProjectId: 'missing-project',
    selectedProjectStage: 'costos'
  }, [{ id: 'other-project' }]);
  assert.deepEqual(result, {
    restore: false,
    module: 'cartera',
    activeProjectId: null,
    selectedProjectStage: 'evidencia'
  });
});
