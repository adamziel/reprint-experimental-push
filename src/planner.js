import { ABSENT, deepClone, stableStringify } from './stable-json.js';
import {
  deserializeResourceValue,
  enumerateResources,
  getResource,
  hasPlugin,
  pluginOwnerFor,
  resourceHash,
  serializeResourceValue,
} from './resources.js';

const SUPPORTED_PLUGIN_DATA_DRIVERS = new Set([
  'wp-option',
  'wp-postmeta',
  'wp-post-meta',
  'wp-termmeta',
  'wp-term-meta',
  'wp-usermeta',
  'wp-user-meta',
  'fixture-forms-lab-table',
]);

const PLUGIN_DATA_DRIVER_TABLES = new Map([
  ['wp-option', 'wp_options'],
  ['wp-postmeta', 'wp_postmeta'],
  ['wp-post-meta', 'wp_postmeta'],
  ['wp-termmeta', 'wp_termmeta'],
  ['wp-term-meta', 'wp_termmeta'],
  ['wp-usermeta', 'wp_usermeta'],
  ['wp-user-meta', 'wp_usermeta'],
]);

const PLUGIN_DATA_DRIVER_TABLE_NAMES = new Set(PLUGIN_DATA_DRIVER_TABLES.values());

export function createPushPlan({ base, local, remote, now = new Date() }) {
  const plan = {
    schemaVersion: 1,
    id: `plan-${now.toISOString()}`,
    generatedAt: now.toISOString(),
    status: 'ready',
    summary: {
      mutations: 0,
      decisions: 0,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
      graphDependencies: 0,
    },
    mutations: [],
    preconditions: [],
    decisions: [],
    conflicts: [],
    blockers: [],
    atomicGroups: [],
    graphDependencies: [],
  };

  const resources = enumerateResources(base, local, remote);
  const intents = Array.isArray(local?.pushIntents) ? local.pushIntents : [];
  const intentByResource = mapIntentsByResource(intents);
  const pluginOwnedResourcePolicy = buildPluginOwnedResourcePolicy({
    base,
    local,
    remote,
    intents,
  });

  for (const resource of resources) {
    const baseValue = getResource(base, resource);
    const localValue = getResource(local, resource);
    const remoteValue = getResource(remote, resource);
    const baseHash = resourceHash(base, resource);
    const localHash = resourceHash(local, resource);
    const remoteHash = resourceHash(remote, resource);
    const owner = pluginOwnerFor(resource, baseValue, localValue, remoteValue);
    const change = changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    );

    const specialFileSupport = unsupportedSpecialFileResourceSupport({
      resource,
      baseValue,
      localValue,
      remoteValue,
    });
    if (!specialFileSupport.supported) {
      addUnsupportedSpecialFileBlocker(plan, {
        resource,
        support: specialFileSupport,
        baseValue,
        localValue,
        remoteValue,
        baseHash,
        localHash,
        remoteHash,
      });
      continue;
    }

    if (localHash === baseHash && remoteHash === baseHash) {
      const steadyCommentsUsersSupport = unsupportedCommentsUsersResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!steadyCommentsUsersSupport.supported) {
        addUnsupportedCommentsUsersResourceBlocker(plan, {
          resource,
          support: steadyCommentsUsersSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyCommentmetaSupport = unsupportedCommentmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!steadyCommentmetaSupport.supported) {
        addUnsupportedCommentmetaResourceBlocker(plan, {
          resource,
          support: steadyCommentmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyUsermetaSupport = unsupportedUsermetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!steadyUsermetaSupport.supported) {
        addUnsupportedUsermetaResourceBlocker(plan, {
          resource,
          support: steadyUsermetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyTermmetaSupport = unsupportedTermmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!steadyTermmetaSupport.supported) {
        addUnsupportedTermmetaResourceBlocker(plan, {
          resource,
          support: steadyTermmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyTermTaxonomySupport = unsupportedTermTaxonomyResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!steadyTermTaxonomySupport.supported) {
        addUnsupportedTermTaxonomyResourceBlocker(plan, {
          resource,
          support: steadyTermTaxonomySupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyAttachmentSupport = unsupportedAttachmentResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!steadyAttachmentSupport.supported) {
        addUnsupportedAttachmentResourceBlocker(plan, {
          resource,
          support: steadyAttachmentSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyRevisionSupport = unsupportedRevisionResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!steadyRevisionSupport.supported) {
        addUnsupportedRevisionResourceBlocker(plan, {
          resource,
          support: steadyRevisionSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyNavigationSupport = unsupportedNavigationResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!steadyNavigationSupport.supported) {
        addUnsupportedNavigationResourceBlocker(plan, {
          resource,
          support: steadyNavigationSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyLegacyLinksSupport = unsupportedLegacyLinksResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!steadyLegacyLinksSupport.supported) {
        addUnsupportedLegacyLinksResourceBlocker(plan, {
          resource,
          support: steadyLegacyLinksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadySerializedBlocksSupport = unsupportedSerializedBlocksSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!steadySerializedBlocksSupport.supported) {
        addUnsupportedSerializedBlocksBlocker(plan, {
          resource,
          support: steadySerializedBlocksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const steadyGuidSupport = unsupportedGuidResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!steadyGuidSupport.supported) {
        addUnsupportedGuidResourceBlocker(plan, {
          resource,
          support: steadyGuidSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      if (isPluginOwnedDataResource(resource, owner)) {
        const support = pluginOwnedResourcePolicy.supportFor(resource, owner);
        if (!support.supported) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
      }

      continue;
    }

    if (localHash === baseHash && remoteHash !== baseHash) {
      const remoteNavigationSupport = unsupportedNavigationResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!remoteNavigationSupport.supported) {
        addUnsupportedNavigationResourceBlocker(plan, {
          resource,
          support: remoteNavigationSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteAttachmentSupport = unsupportedAttachmentResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!remoteAttachmentSupport.supported) {
        addUnsupportedAttachmentResourceBlocker(plan, {
          resource,
          support: remoteAttachmentSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteRevisionSupport = unsupportedRevisionResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!remoteRevisionSupport.supported) {
        addUnsupportedRevisionResourceBlocker(plan, {
          resource,
          support: remoteRevisionSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteTermmetaSupport = unsupportedTermmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!remoteTermmetaSupport.supported) {
        addUnsupportedTermmetaResourceBlocker(plan, {
          resource,
          support: remoteTermmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteTermTaxonomySupport = unsupportedTermTaxonomyResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!remoteTermTaxonomySupport.supported) {
        addUnsupportedTermTaxonomyResourceBlocker(plan, {
          resource,
          support: remoteTermTaxonomySupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteGuidSupport = unsupportedGuidResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!remoteGuidSupport.supported) {
        addUnsupportedGuidResourceBlocker(plan, {
          resource,
          support: remoteGuidSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteCommentsUsersSupport = unsupportedCommentsUsersResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!remoteCommentsUsersSupport.supported) {
        addUnsupportedCommentsUsersResourceBlocker(plan, {
          resource,
          support: remoteCommentsUsersSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteCommentmetaSupport = unsupportedCommentmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!remoteCommentmetaSupport.supported) {
        addUnsupportedCommentmetaResourceBlocker(plan, {
          resource,
          support: remoteCommentmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteUsermetaSupport = unsupportedUsermetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!remoteUsermetaSupport.supported) {
        addUnsupportedUsermetaResourceBlocker(plan, {
          resource,
          support: remoteUsermetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteSerializedBlocksSupport = unsupportedSerializedBlocksSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!remoteSerializedBlocksSupport.supported) {
        addUnsupportedSerializedBlocksBlocker(plan, {
          resource,
          support: remoteSerializedBlocksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const remoteLegacyLinksSupport = unsupportedLegacyLinksResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!remoteLegacyLinksSupport.supported) {
        addUnsupportedLegacyLinksResourceBlocker(plan, {
          resource,
          support: remoteLegacyLinksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      plan.decisions.push({
        id: `decision-${plan.decisions.length + 1}`,
        resource,
        resourceKey: resource.key,
        decision: 'keep-remote',
        reason: 'Remote changed after the pull base; local did not change this resource.',
        baseHash,
        remoteHash,
        change,
      });
      continue;
    }

    if (localHash !== baseHash && remoteHash === baseHash) {
      if (isPluginContextMutationResource(resource, owner)) {
        const pluginContextSupport = pluginContextMutationSupport({
          resource,
          owner,
          resources,
          base,
          local,
          remote,
        });
        if (!pluginContextSupport.supported) {
          addPluginContextBlocker(plan, {
            resource,
            owner,
            support: pluginContextSupport,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
      }

      if (isPluginOwnedDataResource(resource, owner)) {
        const support = pluginOwnedResourcePolicy.supportFor(resource, owner);
        if (!support.supported) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
        const ownerContextSupport = pluginOwnedOwnerContextSupport({
          resource,
          owner,
          resources,
          base,
          local,
          remote,
          intents,
          intentByResource,
        });
        if (!ownerContextSupport.supported) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support: ownerContextSupport,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
        if (localValue === ABSENT && !support.supportsDelete) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support: {
              ...support,
              supported: false,
              className: 'unsupported-plugin-owned-resource',
              reason: support.driverEvidence
                ? 'Fixture forms lab table driver does not support delete mutations without explicit delete opt-in.'
                : 'Plugin-owned resource driver does not support delete mutations.',
            },
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
      }

      const navigationSupport = unsupportedNavigationResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!navigationSupport.supported) {
        addUnsupportedNavigationResourceBlocker(plan, {
          resource,
          support: navigationSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const attachmentSupport = unsupportedAttachmentResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!attachmentSupport.supported) {
        addUnsupportedAttachmentResourceBlocker(plan, {
          resource,
          support: attachmentSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const revisionSupport = unsupportedRevisionResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!revisionSupport.supported) {
        addUnsupportedRevisionResourceBlocker(plan, {
          resource,
          support: revisionSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const termmetaSupport = unsupportedTermmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!termmetaSupport.supported) {
        addUnsupportedTermmetaResourceBlocker(plan, {
          resource,
          support: termmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const termTaxonomySupport = unsupportedTermTaxonomyResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!termTaxonomySupport.supported) {
        addUnsupportedTermTaxonomyResourceBlocker(plan, {
          resource,
          support: termTaxonomySupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const guidSupport = unsupportedGuidResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!guidSupport.supported) {
        addUnsupportedGuidResourceBlocker(plan, {
          resource,
          support: guidSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const commentsUsersSupport = unsupportedCommentsUsersResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!commentsUsersSupport.supported) {
        addUnsupportedCommentsUsersResourceBlocker(plan, {
          resource,
          support: commentsUsersSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const commentmetaSupport = unsupportedCommentmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!commentmetaSupport.supported) {
        addUnsupportedCommentmetaResourceBlocker(plan, {
          resource,
          support: commentmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const usermetaSupport = unsupportedUsermetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!usermetaSupport.supported) {
        addUnsupportedUsermetaResourceBlocker(plan, {
          resource,
          support: usermetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const legacyLinksSupport = unsupportedLegacyLinksResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!legacyLinksSupport.supported) {
        addUnsupportedLegacyLinksResourceBlocker(plan, {
          resource,
          support: legacyLinksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const serializedBlocksSupport = unsupportedSerializedBlocksSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!serializedBlocksSupport.supported) {
        addUnsupportedSerializedBlocksBlocker(plan, {
          resource,
          support: serializedBlocksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const specialFileSupport = unsupportedSpecialFileResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!specialFileSupport.supported) {
        addUnsupportedSpecialFileBlocker(plan, {
          resource,
          support: specialFileSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const graphIdentitySupport = wordpressGraphIdentitySupport({
        resource,
        localValue,
        resources,
        base,
        local,
        remote,
      });
      if (!graphIdentitySupport.supported) {
        addWordPressGraphIdentityBlocker(plan, {
          resource,
          support: graphIdentitySupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const samePlanCreateSupport = samePlanCreatedGraphIdentitySupport({
        resource,
        resources,
        base,
        local,
        remote,
      });
      if (!samePlanCreateSupport.supported) {
        addWordPressGraphIdentityBlocker(plan, {
          resource,
          support: samePlanCreateSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const mutation = {
        id: `mutation-${plan.mutations.length + 1}`,
        resource,
        resourceKey: resource.key,
        action: localValue === ABSENT ? 'delete' : 'put',
        value: serializeResourceValue(localValue),
        remoteBeforeHash: remoteHash,
        baseHash,
        localHash,
        changeKind: change.localChange,
        change,
        atomicGroupId: intentByResource.get(resource.key) || null,
      };
      if (Array.isArray(graphIdentitySupport.references) && graphIdentitySupport.references.length > 0) {
        mutation.wordpressGraphReferences = graphIdentitySupport.references;
      }
      if (isPluginOwnedDataResource(resource, owner)) {
        const support = pluginOwnedResourcePolicy.supportFor(resource, owner);
        mutation.pluginOwnedResource = {
          pluginOwner: owner,
          driver: support.driver,
          policySource: support.policySource,
          supportsDelete: support.supportsDelete,
          driverEvidence: support.driverEvidence,
        };
      }
      plan.mutations.push(mutation);
      plan.preconditions.push({
        mutationId: mutation.id,
        resource,
        resourceKey: resource.key,
        expectedHash: remoteHash,
        checkedAgainst: 'live-remote',
      });
      continue;
    }

    if (localHash === remoteHash) {
      if (isPluginOwnedDataResource(resource, owner)) {
        const support = pluginOwnedResourcePolicy.supportFor(resource, owner);
        if (!support.supported) {
          addPluginOwnedResourceBlocker(plan, {
            resource,
            owner,
            support,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
        const ownerContextSupport = pluginOwnedOwnerContextSupport({
          resource,
          owner,
          resources,
          base,
          local,
          remote,
          intents,
          intentByResource,
        });
        if (!ownerContextSupport.supported) {
          addPluginContextBlocker(plan, {
            resource,
            owner,
            support: ownerContextSupport,
            baseValue,
            localValue,
            remoteValue,
            baseHash,
            localHash,
            remoteHash,
          });
          continue;
        }
      }

      const navigationSupport = unsupportedNavigationResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!navigationSupport.supported) {
        addUnsupportedNavigationResourceBlocker(plan, {
          resource,
          support: navigationSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const attachmentSupport = unsupportedAttachmentResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!attachmentSupport.supported) {
        addUnsupportedAttachmentResourceBlocker(plan, {
          resource,
          support: attachmentSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const revisionSupport = unsupportedRevisionResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!revisionSupport.supported) {
        addUnsupportedRevisionResourceBlocker(plan, {
          resource,
          support: revisionSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const termmetaSupport = unsupportedTermmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!termmetaSupport.supported) {
        addUnsupportedTermmetaResourceBlocker(plan, {
          resource,
          support: termmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const termTaxonomySupport = unsupportedTermTaxonomyResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!termTaxonomySupport.supported) {
        addUnsupportedTermTaxonomyResourceBlocker(plan, {
          resource,
          support: termTaxonomySupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const guidSupport = unsupportedGuidResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!guidSupport.supported) {
        addUnsupportedGuidResourceBlocker(plan, {
          resource,
          support: guidSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const commentsUsersSupport = unsupportedCommentsUsersResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!commentsUsersSupport.supported) {
        addUnsupportedCommentsUsersResourceBlocker(plan, {
          resource,
          support: commentsUsersSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const commentmetaSupport = unsupportedCommentmetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!commentmetaSupport.supported) {
        addUnsupportedCommentmetaResourceBlocker(plan, {
          resource,
          support: commentmetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const usermetaSupport = unsupportedUsermetaResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
        resources,
        base,
        local,
        remote,
      });
      if (!usermetaSupport.supported) {
        addUnsupportedUsermetaResourceBlocker(plan, {
          resource,
          support: usermetaSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const legacyLinksSupport = unsupportedLegacyLinksResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!legacyLinksSupport.supported) {
        addUnsupportedLegacyLinksResourceBlocker(plan, {
          resource,
          support: legacyLinksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const serializedBlocksSupport = unsupportedSerializedBlocksSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!serializedBlocksSupport.supported) {
        addUnsupportedSerializedBlocksBlocker(plan, {
          resource,
          support: serializedBlocksSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const specialFileSupport = unsupportedSpecialFileResourceSupport({
        resource,
        baseValue,
        localValue,
        remoteValue,
      });
      if (!specialFileSupport.supported) {
        addUnsupportedSpecialFileBlocker(plan, {
          resource,
          support: specialFileSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const graphIdentitySupport = wordpressGraphIdentitySupport({
        resource,
        localValue,
        resources,
        base,
        local,
        remote,
      });
      if (!graphIdentitySupport.supported) {
        addWordPressGraphIdentityBlocker(plan, {
          resource,
          support: graphIdentitySupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      const samePlanCreateSupport = samePlanCreatedGraphIdentitySupport({
        resource,
        resources,
        base,
        local,
        remote,
      });
      if (!samePlanCreateSupport.supported) {
        addWordPressGraphIdentityBlocker(plan, {
          resource,
          support: samePlanCreateSupport,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        });
        continue;
      }

      plan.decisions.push({
        id: `decision-${plan.decisions.length + 1}`,
        resource,
        resourceKey: resource.key,
        decision: 'already-in-sync',
        reason: 'Local and remote independently reached the same content.',
        baseHash,
        localHash,
        change,
      });
      continue;
    }

    addConflict(plan, {
      resource,
      reason: 'Local and remote both changed this resource after the pull base.',
      resolutionPolicy: 'preserve-remote-and-stop',
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
      owner,
    });
  }

  finalizeWordPressGraphDependencies(plan, local, remote);
  addFileTopologyConflicts(plan, resources, base, local, remote);
  plan.atomicGroups = intents.map((intent) => buildAtomicGroup(intent, plan, base, remote));
  const existingBlockerIds = new Set(plan.blockers.map((blocker) => blocker.id));
  for (const blocker of plan.atomicGroups.flatMap((group) => group.blockers)) {
    if (!existingBlockerIds.has(blocker.id)) {
      existingBlockerIds.add(blocker.id);
      plan.blockers.push(blocker);
    }
  }
  enforceMutationPreconditionInvariant(plan);

  plan.summary.mutations = plan.mutations.length;
  plan.summary.decisions = plan.decisions.length;
  plan.summary.conflicts = plan.conflicts.length;
  plan.summary.blockers = plan.blockers.length;
  plan.summary.atomicGroups = plan.atomicGroups.length;
  plan.summary.graphDependencies = plan.graphDependencies.length;
  plan.status = plan.conflicts.length > 0
    ? 'conflict'
    : plan.blockers.length > 0
      ? 'blocked'
      : 'ready';

  return plan;
}

function mapIntentsByResource(intents) {
  const map = new Map();
  for (const intent of intents) {
    for (const resourceKey of intent.resources || []) {
      map.set(resourceKey, intent.id);
    }
  }
  return map;
}

function buildPluginOwnedResourcePolicy({ base, local, remote, intents }) {
  const entries = [
    ...pluginOwnedPolicyEntriesFromSnapshot(base, 'base-snapshot'),
    ...pluginOwnedPolicyEntriesFromSnapshot(local, 'local-snapshot'),
    ...pluginOwnedPolicyEntriesFromSnapshot(remote, 'remote-snapshot'),
    ...intents.flatMap((intent) => pluginOwnedPolicyEntriesFromIntent(intent)),
  ];

  return {
    supportFor(resource, owner) {
      const candidates = entries.filter((entry) =>
        entry.resourceKey === resource.key && entry.pluginOwner === owner);

      if (candidates.length === 0) {
        const customTable = resource.type === 'row'
          && typeof resource.table === 'string'
          && !PLUGIN_DATA_DRIVER_TABLE_NAMES.has(resource.table);
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          resourceKind: customTable ? 'custom-table' : null,
          allowSteadyUnsupported: customTable,
          reason: customTable
            ? 'Plugin-owned custom tables, including deletes, are not yet supported by the planner.'
            : 'Plugin-owned resource has no explicit driver metadata and cannot be applied safely.',
        };
      }

      const withDriver = candidates.find((entry) => entry.driver);
      if (!withDriver) {
        return {
          supported: false,
          className: 'missing-plugin-driver',
          policySource: candidates[0].source,
        };
      }

      const distinctDrivers = new Set(candidates.filter((entry) => entry.driver).map((entry) => entry.driver));
      if (distinctDrivers.size > 1) {
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          resourceKind: 'custom-table',
          driver: withDriver.driver,
          policySource: withDriver.source,
          reason: 'Plugin-owned resource has conflicting driver metadata and cannot be applied safely.',
        };
      }

      const supported = candidates.find((entry) =>
        SUPPORTED_PLUGIN_DATA_DRIVERS.has(entry.driver)
        && pluginOwnedPolicyEntryMatchesResource(entry, resource, owner));
      if (!supported) {
        const supportedDriverTable = PLUGIN_DATA_DRIVER_TABLES.get(withDriver.driver);
        const unsupportedCustomTable = resource.type === 'row'
          && typeof resource.table === 'string'
          && resource.table !== supportedDriverTable
          && !PLUGIN_DATA_DRIVER_TABLE_NAMES.has(resource.table);
        return {
          supported: false,
          className: 'unsupported-plugin-owned-resource',
          resourceKind: unsupportedCustomTable ? 'custom-table' : 'row',
          driver: withDriver.driver,
          policySource: withDriver.source,
          reason: unsupportedCustomTable
            ? 'Plugin-owned custom tables are not yet supported by the planner.'
            : 'Plugin-owned resource driver does not match the resource type or table.',
        };
      }

      if (supported.driver === 'fixture-forms-lab-table') {
        const driverEvidence = fixtureFormsLabTableDriverEvidence({
          resource,
          owner,
          base,
          local,
          remote,
        });
        if (!driverEvidence.supported) {
          return {
            supported: false,
            className: 'unsupported-plugin-owned-resource',
            driver: supported.driver,
            policySource: supported.source,
            reason: driverEvidence.reason,
          };
        }
        return {
          supported: true,
          driver: supported.driver,
          policySource: supported.source,
          supportsDelete: false,
          driverEvidence,
        };
      }

      return {
        supported: true,
        driver: supported.driver,
        policySource: supported.source,
        supportsDelete: supported.supportsDelete === true,
      };
    },
  };
}

function pluginOwnedPolicyEntriesFromSnapshot(snapshot, source) {
  return normalizePluginOwnedPolicy(snapshot?.meta?.pushPolicy, source)
    .concat(normalizePluginOwnedPolicy(snapshot?.meta?.resourcePolicy, source))
    .concat(normalizePluginOwnedPolicy(snapshot?.meta?.pluginOwnedResources, source));
}

function pluginOwnedPolicyEntriesFromIntent(intent) {
  const source = `push-intent:${intent.id || 'unlabeled'}`;
  return normalizePluginOwnedPolicy(intent.resourcePolicy, source)
    .concat(normalizePluginOwnedPolicy(intent.pushPolicy, source))
    .concat(normalizePluginOwnedPolicy(intent.pluginOwnedResources, source));
}

function normalizePluginOwnedPolicy(policy, source) {
  if (!policy || typeof policy !== 'object') {
    return [];
  }

  const pluginOwnedResources = policy.pluginOwnedResources || policy;
  const allowedResources = normalizeAllowedResources(
    pluginOwnedResources.allowedResources
      || pluginOwnedResources.allowed
      || pluginOwnedResources.resources,
  );

  return allowedResources
    .map((entry) => normalizePluginOwnedPolicyEntry(entry, source))
    .filter((entry) => entry.resourceKey && entry.pluginOwner);
}

function normalizeAllowedResources(allowedResources) {
  if (Array.isArray(allowedResources)) {
    return allowedResources;
  }
  if (!allowedResources || typeof allowedResources !== 'object') {
    return [];
  }
  return Object.entries(allowedResources).map(([resourceKey, entry]) => ({
    ...(entry && typeof entry === 'object' ? entry : {}),
    resourceKey,
  }));
}

function normalizePluginOwnedPolicyEntry(entry, source) {
  if (typeof entry === 'string') {
    return { resourceKey: entry, source };
  }
  if (!entry || typeof entry !== 'object') {
    return { source };
  }
  return {
    resourceKey: entry.resourceKey || entry.key || entry.resource?.key || null,
    pluginOwner: entry.pluginOwner || entry.owner || entry.plugin || null,
    driver: entry.driver || entry.supportedDriver || entry.resourceDriver || null,
    supportsDelete: entry.supportsDelete === true || entry.delete === true || entry.allowDelete === true,
    source,
  };
}

function pluginOwnedPolicyEntryMatchesResource(entry, resource, owner) {
  if (entry.pluginOwner !== owner) {
    return false;
  }

  if (entry.driver !== 'fixture-forms-lab-table') {
    const expectedTable = PLUGIN_DATA_DRIVER_TABLES.get(entry.driver);
    return resource.type === 'row' && resource.table === expectedTable;
  }

  return resource.type === 'row'
    && resource.table === 'wp_reprint_push_forms_lab'
    && /^id:\d+$/.test(resource.id)
    && owner === 'forms'
    && entry.pluginOwner === 'forms';
}

function fixtureFormsLabTableDriverEvidence({ resource, owner, base, remote }) {
  if (
    resource.type !== 'row'
    || resource.table !== 'wp_reprint_push_forms_lab'
    || !/^id:[1-9]\d*$/.test(resource.id)
    || owner !== 'forms'
  ) {
    return { supported: false, reason: 'Fixture forms lab table driver only supports positive id rows owned by forms.' };
  }

  const plugin = 'reprint-push-forms-fixture';
  const pluginResource = { type: 'plugin', name: plugin, key: `plugin:${plugin}` };
  const basePlugin = getResource(base, pluginResource);
  const remotePlugin = getResource(remote, pluginResource);
  const baseHash = resourceHash(base, pluginResource);
  const remoteHash = resourceHash(remote, pluginResource);
  if (
    basePlugin !== ABSENT
    && remotePlugin !== ABSENT
    && basePlugin?.active === true
    && remotePlugin?.active === true
    && baseHash === remoteHash
  ) {
    return {
      supported: true,
      source: 'live-remote',
      plugin,
      resourceKey: pluginResource.key,
      baseHash,
      remoteHash,
    };
  }

  return {
    supported: false,
    reason: 'Fixture forms lab table driver requires unchanged active reprint-push-forms-fixture evidence.',
  };
}

function buildAtomicGroup(intent, plan, base, remote) {
  const groupResourceKeys = new Set(intent.resources || []);
  const mutationIds = plan.mutations
    .filter((mutation) => mutation.atomicGroupId === intent.id)
    .map((mutation) => mutation.id);
  const conflicts = plan.conflicts
    .filter((conflict) => (intent.resources || []).includes(conflict.resourceKey))
    .map((conflict) => conflict.id);
  const blockers = plan.blockers.filter((blocker) => groupResourceKeys.has(blocker.resourceKey));
  const requiredPlugins = normalizePluginDependencies(intent.dependencies?.plugins || []);

  requiredPlugins.forEach((dependency, index) => {
    blockers.push(...evaluatePluginDependency({
      dependency,
      dependencyIndex: index,
      intent,
      groupResourceKeys,
      plan,
      base,
      remote,
    }));
  });

  if (requiredPlugins.some((dependency) => !dependency.name)) {
    blockers.push({
      id: `blocker-${intent.id}-invalid-plugin-dependency`,
      class: 'invalid-plugin-dependency-metadata',
      groupId: intent.id,
      reason: `Atomic push intent ${intent.id} declares a plugin dependency without a plugin name.`,
    });
  }

  return {
    id: intent.id,
    kind: intent.kind || 'change-set',
    label: intent.label || intent.id,
    requireAtomic: intent.requireAtomic !== false,
    resources: [...(intent.resources || [])],
    mutationIds,
    conflicts,
    dependencies: normalizeGroupDependencies(intent.dependencies || {}, requiredPlugins),
    dependencyRequirements: requiredPlugins.map((dependency) => ({
      plugin: dependency.name,
      expectedVersion: dependency.expectedVersion,
      versionRange: dependency.versionRange,
      expectedHash: dependency.expectedHash,
      active: dependency.active,
      ...pluginDependencyEvidence(dependency, intent, plan, base, remote),
    })),
    status: conflicts.length > 0 ? 'conflict' : blockers.length > 0 ? 'blocked' : 'ready',
    blockers,
  };
}

function pluginDependencyEvidence(dependency, intent, plan, base, remote) {
  if (!dependency.name) {
    return { source: 'invalid' };
  }

  const plugin = dependency.name;
  const pluginResource = { type: 'plugin', name: plugin, key: `plugin:${plugin}` };
  const sameGroupMutation = plan.mutations.find((mutation) =>
    mutation.resourceKey === pluginResource.key && mutation.atomicGroupId === intent.id);
  if (sameGroupMutation) {
    const plannedValue = deserializeResourceValue(sameGroupMutation.value);
    return {
      source: 'same-atomic-group',
      mutationId: sameGroupMutation.id,
      resourceKey: pluginResource.key,
      plannedHash: plannedValue === ABSENT ? resourceHash({ plugins: {} }, pluginResource) : digestPluginValue(plannedValue),
    };
  }

  if (!hasPlugin(remote, plugin)) {
    return {
      source: 'missing-live-remote',
      resourceKey: pluginResource.key,
    };
  }

  return {
    source: 'live-remote',
    resourceKey: pluginResource.key,
    baseHash: resourceHash(base, pluginResource),
    remoteHash: resourceHash(remote, pluginResource),
  };
}

function normalizeGroupDependencies(dependencies, requiredPlugins) {
  return {
    plugins: requiredPlugins
      .map((dependency) => dependency.name)
      .filter(Boolean),
  };
}

function normalizePluginDependencies(dependencies) {
  return dependencies.map((dependency) => {
    if (typeof dependency === 'string') {
      return { name: dependency };
    }
    if (!dependency || typeof dependency !== 'object') {
      return { name: null, raw: dependency };
    }
    const version = dependency.version ?? null;
    const requiredVersion = dependency.requiredVersion ?? null;
    return {
      name: dependency.name || dependency.slug || dependency.plugin || null,
      expectedVersion: dependency.expectedVersion
        ?? dependency.exactVersion
        ?? (typeof version === 'string' && !looksLikeVersionRange(version) ? version : null)
        ?? (typeof requiredVersion === 'string' && !looksLikeVersionRange(requiredVersion)
          ? requiredVersion
          : null),
      versionRange: dependency.versionRange
        ?? dependency.range
        ?? (typeof version === 'string' && looksLikeVersionRange(version) ? version : null)
        ?? (typeof requiredVersion === 'string' && looksLikeVersionRange(requiredVersion)
          ? requiredVersion
          : null),
      expectedHash: dependency.expectedHash ?? dependency.hash ?? dependency.resourceHash ?? null,
      active: typeof dependency.active === 'boolean' ? dependency.active : null,
      raw: deepClone(dependency),
    };
  });
}

function evaluatePluginDependency({
  dependency,
  dependencyIndex,
  intent,
  groupResourceKeys,
  plan,
  base,
  remote,
}) {
  if (!dependency.name) {
    return [];
  }

  const blockers = [];
  const plugin = dependency.name;
  const pluginResource = { type: 'plugin', name: plugin, key: `plugin:${plugin}` };
  const sameGroupMutation = plan.mutations.find((mutation) =>
    mutation.resourceKey === pluginResource.key && mutation.atomicGroupId === intent.id);
  const outsideGroupMutation = plan.mutations.find((mutation) =>
    mutation.resourceKey === pluginResource.key && mutation.atomicGroupId !== intent.id);
  const dependencyConflict = plan.conflicts.find((conflict) =>
    conflict.resourceKey === pluginResource.key);

  if (dependencyConflict && !groupResourceKeys.has(pluginResource.key)) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'conflicting-plugin-dependency',
      reason: `Atomic push intent ${intent.id} depends on plugin ${plugin}, but that dependency already has a conflict.`,
      extra: { conflictId: dependencyConflict.id },
    }));
    return blockers;
  }

  if (sameGroupMutation) {
    const plannedValue = deserializeResourceValue(sameGroupMutation.value);
    if (plannedValue === ABSENT) {
      blockers.push(pluginDependencyBlocker({
        intent,
        dependency,
        dependencyIndex,
        className: 'missing-plugin-dependency',
        reason: `Atomic push intent ${intent.id} would remove required plugin ${plugin}.`,
      }));
      return blockers;
    }
    blockers.push(...validatePluginDependencyValue({
      dependency,
      dependencyIndex,
      intent,
      value: plannedValue,
      hash: digestPluginValue(plannedValue),
      source: 'same-atomic-group',
    }));
    return blockers;
  }

  if (outsideGroupMutation) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'plugin-dependency-outside-atomic-group',
      reason: `Atomic push intent ${intent.id} depends on plugin ${plugin}, but its planned mutation is outside this atomic group.`,
      extra: { mutationId: outsideGroupMutation.id },
    }));
    return blockers;
  }

  if (!hasPlugin(remote, plugin)) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'missing-plugin-dependency',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin}, but it is absent from the live remote.`,
    }));
    return blockers;
  }

  const baseHash = resourceHash(base, pluginResource);
  const remoteHash = resourceHash(remote, pluginResource);
  if (baseHash !== remoteHash) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'remote-plugin-dependency-drift',
      reason: `Atomic push intent ${intent.id} depends on plugin ${plugin}, but the live remote dependency changed since the pull base.`,
      extra: {
        baseHash,
        remoteHash,
      },
    }));
    return blockers;
  }

  blockers.push(...validatePluginDependencyValue({
    dependency,
    dependencyIndex,
    intent,
    value: getResource(remote, pluginResource),
    hash: remoteHash,
    source: 'live-remote',
  }));

  return blockers;
}

function validatePluginDependencyValue({ dependency, dependencyIndex, intent, value, hash, source }) {
  const blockers = [];
  const plugin = dependency.name;

  if (dependency.expectedHash && dependency.expectedHash !== hash) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'plugin-dependency-hash-mismatch',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin} at hash ${dependency.expectedHash}, but ${source} has ${hash}.`,
      extra: { expectedHash: dependency.expectedHash, actualHash: hash, source },
    }));
  }

  const actualVersion = value?.version;
  if ((dependency.expectedVersion || dependency.versionRange) && typeof actualVersion !== 'string') {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'plugin-dependency-version-missing',
      reason: `Atomic push intent ${intent.id} requires a versioned plugin dependency ${plugin}, but ${source} has no version metadata.`,
      extra: { source },
    }));
    return blockers;
  }

  if (dependency.expectedVersion && actualVersion !== dependency.expectedVersion) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'incompatible-plugin-dependency-version',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin} version ${dependency.expectedVersion}, but ${source} has ${actualVersion}.`,
      extra: { expectedVersion: dependency.expectedVersion, actualVersion, source },
    }));
  }

  if (dependency.versionRange) {
    const rangeResult = satisfiesVersionRange(actualVersion, dependency.versionRange);
    if (rangeResult.unsupported) {
      blockers.push(pluginDependencyBlocker({
        intent,
        dependency,
        dependencyIndex,
        className: 'unsupported-plugin-dependency-version-range',
        reason: `Atomic push intent ${intent.id} declares unsupported version range ${dependency.versionRange} for plugin ${plugin}.`,
        extra: { versionRange: dependency.versionRange, actualVersion, source },
      }));
    } else if (!rangeResult.satisfied) {
      blockers.push(pluginDependencyBlocker({
        intent,
        dependency,
        dependencyIndex,
        className: 'incompatible-plugin-dependency-version-range',
        reason: `Atomic push intent ${intent.id} requires plugin ${plugin} version ${dependency.versionRange}, but ${source} has ${actualVersion}.`,
        extra: { versionRange: dependency.versionRange, actualVersion, source },
      }));
    }
  }

  if (dependency.active != null && Boolean(value?.active) !== dependency.active) {
    blockers.push(pluginDependencyBlocker({
      intent,
      dependency,
      dependencyIndex,
      className: 'incompatible-plugin-dependency-activation',
      reason: `Atomic push intent ${intent.id} requires plugin ${plugin} active=${dependency.active}, but ${source} has active=${Boolean(value?.active)}.`,
      extra: { expectedActive: dependency.active, actualActive: Boolean(value?.active), source },
    }));
  }

  return blockers;
}

function pluginDependencyBlocker({
  intent,
  dependency,
  dependencyIndex,
  className,
  reason,
  extra = {},
}) {
  return {
    id: `blocker-${intent.id}-${dependency.name || 'plugin'}-${dependencyIndex}`,
    class: className,
    groupId: intent.id,
    plugin: dependency.name,
    dependencyIndex,
    dependency: pluginDependencyAuditEvidence(dependency),
    reason,
    ...extra,
  };
}

function pluginDependencyAuditEvidence(dependency) {
  const evidence = {
    plugin: dependency.name || null,
  };

  if (dependency.expectedVersion) {
    evidence.expectedVersion = dependency.expectedVersion;
  }
  if (dependency.versionRange) {
    evidence.versionRange = dependency.versionRange;
  }
  if (dependency.expectedHash) {
    evidence.expectedHash = dependency.expectedHash;
  }
  if (typeof dependency.active === 'boolean') {
    evidence.active = dependency.active;
  }

  return evidence;
}

function digestPluginValue(value) {
  return resourceHash({ plugins: { __dependency__: value } }, {
    type: 'plugin',
    name: '__dependency__',
    key: 'plugin:__dependency__',
  });
}

function looksLikeVersionRange(version) {
  return /[<>=~^* ]/.test(version);
}

function satisfiesVersionRange(version, range) {
  const comparators = String(range).trim().split(/\s+/).filter(Boolean);
  if (comparators.length === 0) {
    return { supported: false, unsupported: true, satisfied: false };
  }

  for (const comparator of comparators) {
    const match = comparator.match(/^(>=|>|<=|<|=)?(.+)$/);
    if (!match) {
      return { supported: false, unsupported: true, satisfied: false };
    }
    const operator = match[1] || '=';
    const expected = match[2];
    const comparison = compareVersions(version, expected);
    if (comparison === null || !comparatorSatisfied(comparison, operator)) {
      return comparison === null
        ? { supported: false, unsupported: true, satisfied: false }
        : { supported: true, unsupported: false, satisfied: false };
    }
  }

  return { supported: true, unsupported: false, satisfied: true };
}

function comparatorSatisfied(comparison, operator) {
  if (operator === '>') {
    return comparison > 0;
  }
  if (operator === '>=') {
    return comparison >= 0;
  }
  if (operator === '<') {
    return comparison < 0;
  }
  if (operator === '<=') {
    return comparison <= 0;
  }
  return comparison === 0;
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) {
    return null;
  }
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(version) {
  const normalized = String(version).replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(normalized)) {
    return null;
  }
  return normalized.split('.').map((part) => Number.parseInt(part, 10));
}

function conflictClass(resource, owner) {
  if (owner && resource.type !== 'plugin') {
    return 'plugin-data-conflict';
  }
  if (resource.type === 'file') {
    return 'file-conflict';
  }
  if (resource.type === 'plugin') {
    return 'plugin-conflict';
  }
  return 'row-conflict';
}

function isPluginOwnedDataResource(resource, owner) {
  return resource.type === 'row' && Boolean(owner);
}

const WORDPRESS_GRAPH_TABLE_SUFFIXES = [
  'commentmeta',
  'comments',
  'term_relationships',
  'term_taxonomy',
  'postmeta',
  'termmeta',
  'usermeta',
  'posts',
  'terms',
  'users',
];

function wordpressGraphIdentitySupport({
  resource,
  localValue,
  resources,
  base,
  local,
  remote,
}) {
  if (resource.type !== 'row' || localValue === ABSENT) {
    return { supported: true };
  }

  const references = wordpressGraphReferences(resource, localValue);
  if (references.length === 0) {
    return { supported: true };
  }

  const baseValue = getResource(base, resource);
  const referenceEvidence = references.map((reference) =>
    wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
  const samePlanGraphReferences = referenceEvidence
    .filter((reference) =>
      isSupportedSamePlanPostParentReference({
        baseValue,
        localValue,
        reference,
        local,
      })
      || (
      isSupportedSamePlanPostmetaReference({
        baseValue,
        localValue,
        reference,
        local,
      })
      || isSupportedSamePlanTermRelationshipObjectReference({
        baseValue,
        localValue,
        reference,
        local,
      })
      || isSupportedSamePlanTermmetaReference({
        baseValue,
        reference,
        local,
        remote,
      })
      || isSupportedSamePlanTermTaxonomyReference({
        baseValue,
        localValue,
        reference,
        local,
        remote,
      })
      || isSupportedSamePlanTermTaxonomyParentReference({
        baseValue,
        localValue,
        reference,
        local,
        remote,
      })
      || isSupportedSamePlanTermRelationshipTaxonomyReference({
        baseValue,
        localValue,
        reference,
      })))
    .map((reference) => samePlanWordPressGraphReferenceEvidence(reference));
  const samePlanCreatedTermRelationshipTaxonomyReferences = referenceEvidence.filter((reference) =>
    reference.relationshipType === 'term-relationship-taxonomy'
    && isSamePlanWordPressGraphCreate(reference));
  if (samePlanCreatedTermRelationshipTaxonomyReferences.length > 0) {
    const supportedSamePlanTermRelationshipTaxonomyReferences = samePlanCreatedTermRelationshipTaxonomyReferences
      .filter((reference) =>
        isSupportedSamePlanTermRelationshipTaxonomyReference({
          baseValue,
          localValue,
          reference,
        })
        && unsupportedTermTaxonomyResourceSupport({
          resource: reference.targetResource,
          baseValue: getResource(base, reference.targetResource),
          localValue: getResource(local, reference.targetResource),
          remoteValue: getResource(remote, reference.targetResource),
          resources,
          base,
          local,
          remote,
        }).supported);
    if (supportedSamePlanTermRelationshipTaxonomyReferences.length !== samePlanCreatedTermRelationshipTaxonomyReferences.length) {
      return {
        supported: false,
        className: 'stale-wordpress-graph-identity',
        reason: `WordPress graph mutation ${resource.key} references graph identities without proven identity mapping or reference rewriting.`,
        references: samePlanCreatedTermRelationshipTaxonomyReferences,
      };
    }
  }
  if (resource.table === 'wp_postmeta') {
    const samePlanCreatedPostReferences = referenceEvidence.filter((reference) =>
      reference.relationshipType === 'postmeta-post'
      && reference.targetResource?.table === 'wp_posts'
      && reference.targetChange.remote.state === 'absent'
      && reference.targetChange.local.state === 'present');
    const samePlanCreatedRevisionReferences = referenceEvidence.find((reference) =>
      reference.relationshipType === 'postmeta-post'
      && reference.targetResource?.table === 'wp_posts'
      && getResource(local, reference.targetResource)?.post_type === 'revision'
      && reference.targetChange.remote.state === 'absent');

    if (samePlanCreatedRevisionReferences) {
      return {
        supported: false,
        className: 'unsupported-revision-resource',
        reason: 'Revision graph resources are not yet supported by the planner.',
        references: [samePlanCreatedRevisionReferences],
      };
    }

    const samePlanCreatedAttachmentReferences = samePlanCreatedPostReferences.find((reference) =>
      getResource(local, reference.targetResource)?.post_type === 'attachment');
    if (samePlanCreatedAttachmentReferences) {
      return {
        supported: false,
        className: 'stale-wordpress-graph-identity',
        reason: `WordPress graph mutation ${resource.key} references a post meta attachment identity without proven identity mapping or reference rewriting.`,
        references: [samePlanCreatedAttachmentReferences],
      };
    }

    const unsupportedSamePlanPostReference = samePlanCreatedPostReferences.find((reference) =>
      !isSupportedSamePlanPostmetaReference({
        baseValue,
        localValue,
        reference,
        local,
      }));
    if (unsupportedSamePlanPostReference) {
      return {
        supported: false,
        className: 'stale-wordpress-graph-identity',
        reason: `WordPress graph mutation ${resource.key} references a post meta target identity without proven identity mapping or reference rewriting.`,
        references: [unsupportedSamePlanPostReference],
      };
    }
  }
  if (resource.table === 'wp_term_relationships') {
    const samePlanCreatedPostReferences = referenceEvidence.filter((reference) =>
      reference.relationshipType === 'term-relationship-object'
      && reference.targetResource?.table === 'wp_posts'
      && reference.targetChange.remote.state === 'absent'
      && reference.targetChange.local.state === 'present');
    const samePlanCreatedRevisionReference = samePlanCreatedPostReferences.find((reference) =>
      getResource(local, reference.targetResource)?.post_type === 'revision');
    if (samePlanCreatedRevisionReference) {
      return {
        supported: false,
        className: 'unsupported-revision-resource',
        reason: 'Revision graph resources are not yet supported by the planner.',
        references: [samePlanCreatedRevisionReference],
      };
    }

    const samePlanCreatedAttachmentReference = samePlanCreatedPostReferences.find((reference) =>
      getResource(local, reference.targetResource)?.post_type === 'attachment');
    if (samePlanCreatedAttachmentReference) {
      return {
        supported: false,
        className: 'unsupported-attachment-resource',
        reason: 'Attachment graph resources are not yet supported by the planner.',
        references: [samePlanCreatedAttachmentReference],
      };
    }

    const samePlanCreatedNavigationReference = samePlanCreatedPostReferences.find((reference) =>
      ['nav_menu_item', 'wp_navigation'].includes(
        getResource(local, reference.targetResource)?.post_type,
      ));
    if (samePlanCreatedNavigationReference) {
      return {
        supported: false,
        className: 'unsupported-navigation-resource',
        reason: 'Navigation and menu graph resources are not yet supported by the planner.',
        references: [samePlanCreatedNavigationReference],
      };
    }

    const unsupportedSamePlanPostReference = samePlanCreatedPostReferences.find((reference) =>
      !isSupportedSamePlanTermRelationshipObjectReference({
        baseValue,
        localValue,
        reference,
        local,
      }));
    if (unsupportedSamePlanPostReference) {
      return {
        supported: false,
        className: 'stale-wordpress-graph-identity',
        reason: `WordPress graph mutation ${resource.key} references a term relationship post identity without proven identity mapping or reference rewriting.`,
        references: [unsupportedSamePlanPostReference],
      };
    }
  }
  if (resource.table === 'wp_comments') {
    const samePlanCreatedCommentParentReference = referenceEvidence.find((reference) =>
      reference.relationshipType === 'comment-parent'
      && reference.targetResource?.table === 'wp_comments'
      && reference.targetChange.remote.state === 'absent'
      && reference.targetChange.local.state === 'present');

    if (samePlanCreatedCommentParentReference) {
      return {
        supported: false,
        className: 'unsupported-comments-users-resource',
        reason: 'Comment graph resources are not yet supported by the planner.',
      };
    }
  }
  if (resource.table === 'wp_posts' && localValue.post_type === 'nav_menu_item') {
    const menuItemParentReference = referenceEvidence.find((reference) =>
      reference.relationshipType === 'menu-item-parent'
      && reference.targetResource?.table === 'wp_posts'
      && ['wp_navigation', 'nav_menu_item'].includes(getResource(local, reference.targetResource)?.post_type)
      && reference.targetChange.remote.state === 'absent');

    if (menuItemParentReference) {
      return {
        supported: false,
        className: 'unsupported-navigation-resource',
        reason: 'Navigation and menu graph resources are not yet supported by the planner.',
      };
    }
  }
  if (resource.table === 'wp_posts' && localValue.post_type === 'wp_navigation') {
    const inboundNavigationReference = referenceEvidence.find((reference) =>
      reference.relationshipType === 'post-parent'
      && reference.targetResource?.table === 'wp_posts'
      && ['wp_navigation', 'nav_menu_item'].includes(getResource(local, reference.targetResource)?.post_type)
      && reference.targetChange.remote.state === 'absent');

    if (inboundNavigationReference) {
      return {
        supported: false,
        className: 'unsupported-navigation-resource',
        reason: 'Navigation and menu graph resources are not yet supported by the planner.',
      };
    }
  }
  if (resource.table === 'wp_posts' && normalizePositiveInteger(localValue.post_parent) != null) {
    const postParentTarget = wordpressGraphTargetResource({
      sourceTable: resource.table,
      targetSuffix: 'posts',
      id: normalizePositiveInteger(localValue.post_parent),
    });
    const localPostParentTarget = getResource(local, postParentTarget);
    if (localPostParentTarget?.post_type === 'attachment' && getResource(remote, postParentTarget) === ABSENT) {
      return {
        supported: false,
        className: 'unsupported-attachment-resource',
        reason: 'Attachment graph resources are not yet supported by the planner.',
      };
    }
    if (['wp_navigation', 'nav_menu_item'].includes(localPostParentTarget?.post_type) && getResource(remote, postParentTarget) === ABSENT) {
      return {
        supported: false,
        className: 'unsupported-navigation-resource',
        reason: 'Navigation and menu graph resources are not yet supported by the planner.',
      };
    }
    if (localPostParentTarget?.post_type === 'revision' && getResource(remote, postParentTarget) === ABSENT) {
      return {
        supported: false,
        className: 'unsupported-revision-resource',
        reason: 'Revision graph resources are not yet supported by the planner.',
      };
    }

    const samePlanCreatedPostParentReference = referenceEvidence.find((reference) =>
      reference.relationshipType === 'post-parent'
      && reference.targetResource?.table === 'wp_posts'
      && reference.targetChange.remote.state === 'absent'
      && reference.targetChange.local.state === 'present');
    if (
      samePlanCreatedPostParentReference
      && baseValue === ABSENT
      && localPostParentTarget
      && !['attachment', 'revision', 'nav_menu_item', 'wp_navigation'].includes(localPostParentTarget.post_type ?? 'post')
    ) {
      return {
        supported: false,
        className: 'stale-wordpress-graph-identity',
        reason: `WordPress graph mutation ${resource.key} references a post parent identity without proven identity mapping or reference rewriting.`,
        references: [samePlanCreatedPostParentReference],
      };
    }
  }
  if (resource.table === 'wp_posts' && normalizePositiveInteger(localValue.post_author) != null) {
    const samePlanCreatedPostAuthorReference = referenceEvidence.find((reference) =>
      reference.relationshipType === 'post-author'
      && reference.targetResource?.table === 'wp_users'
      && reference.targetChange.remote.state === 'absent'
      && reference.targetChange.local.state === 'present');

    if (samePlanCreatedPostAuthorReference) {
      return {
        supported: false,
        className: 'stale-wordpress-graph-identity',
        reason: `WordPress graph mutation ${resource.key} references a post author identity without proven identity mapping or reference rewriting.`,
        references: [samePlanCreatedPostAuthorReference],
      };
    }
  }
  const unsupportedAttachmentReferences = referenceEvidence
    .filter((reference) =>
      reference.relationshipType === 'featured-image-attachment'
      || (
        reference.relationshipType === 'post-parent'
        && reference.targetResource?.table === 'wp_posts'
        && getResource(remote, reference.targetResource)?.post_type === 'attachment'
      )
      || (
        reference.targetChange.remote.state === 'absent'
        && reference.targetChange.local.state === 'present'
        && getResource(local, reference.targetResource)?.post_type === 'attachment'
      ));

  if (unsupportedAttachmentReferences.length > 0) {
    return {
      supported: false,
      className: 'unsupported-attachment-resource',
      reason: 'Attachment graph resources are not yet supported by the planner.',
      references: unsupportedAttachmentReferences,
    };
  }

  const unsupportedRevisionReferences = referenceEvidence
    .filter((reference) =>
      reference.relationshipType === 'post-parent'
      && reference.targetResource?.table === 'wp_posts'
      && (
        getResource(remote, reference.targetResource)?.post_type === 'revision'
        || (
          reference.targetChange.remote.state === 'absent'
          && getResource(local, reference.targetResource)?.post_type === 'revision'
        )
      ));

  if (unsupportedRevisionReferences.length > 0) {
    return {
      supported: false,
      className: 'unsupported-revision-resource',
      reason: 'Revision graph resources are not yet supported by the planner.',
    };
  }

  const unsafeReferences = references
    .map((reference) => wordpressGraphReferenceEvidence(reference, resources, base, local, remote))
    .filter(Boolean)
    .filter((reference) => isUnsafeWordPressGraphReference(reference));

  if (unsafeReferences.length === 0) {
    return samePlanGraphReferences.length > 0
      ? {
        supported: true,
        references: samePlanGraphReferences,
      }
      : { supported: true };
  }

  const unsafePostParentReference = unsafeReferences.find((reference) =>
    reference.relationshipType === 'post-parent'
    && reference.targetResource?.table === 'wp_posts');
  const unsafeCommentPostReference = unsafeReferences.find((reference) =>
    reference.relationshipType === 'comment-post'
    && reference.targetResource?.table === 'wp_posts');
  const unsafeTermRelationshipPostReference = unsafeReferences.find((reference) =>
    reference.relationshipType === 'term-relationship-object'
    && reference.targetResource?.table === 'wp_posts');
  const unsafePostAuthorReference = unsafeReferences.find((reference) =>
    reference.relationshipType === 'post-author'
    && reference.targetResource?.table === 'wp_users');
  const unsafeFeaturedImageReference = unsafeReferences.find((reference) =>
    reference.relationshipType === 'featured-image-attachment'
    && reference.targetResource?.table === 'wp_posts');
  const unsafeCommentUserReference = unsafeReferences.find((reference) =>
    reference.relationshipType === 'comment-user'
    && reference.targetResource?.table === 'wp_users');
  const unsafeTermmetaTermReference = unsafeReferences.find((reference) =>
    reference.relationshipType === 'termmeta-term'
    && reference.targetResource?.table === 'wp_terms');
  let reason = `WordPress graph mutation ${resource.key} references graph identities without proven identity mapping or reference rewriting.`;
  if (unsafePostParentReference) {
    reason = `WordPress graph mutation ${resource.key} references a post parent identity without proven identity mapping or reference rewriting.`;
  } else if (unsafeCommentPostReference) {
    reason = `WordPress graph mutation ${resource.key} references a comment post identity without proven identity mapping or reference rewriting.`;
  } else if (unsafeTermRelationshipPostReference) {
    reason = `WordPress graph mutation ${resource.key} references a term relationship post identity without proven identity mapping or reference rewriting.`;
  } else if (unsafePostAuthorReference) {
    reason = `WordPress graph mutation ${resource.key} references a post author identity without proven identity mapping or reference rewriting.`;
  } else if (unsafeFeaturedImageReference) {
    reason = `WordPress graph mutation ${resource.key} references a featured image attachment identity without proven identity mapping or reference rewriting.`;
  } else if (unsafeCommentUserReference) {
    reason = `WordPress graph mutation ${resource.key} references a comment user identity without proven identity mapping or reference rewriting.`;
  } else if (unsafeTermmetaTermReference) {
    reason = `WordPress graph mutation ${resource.key} references a term meta term identity without proven identity mapping or reference rewriting.`;
  }

  return {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason,
    references: unsafeReferences,
  };
}

function isUnsafeWordPressGraphReference(reference) {
  if (isSamePlanWordPressGraphCreate(reference)) {
    return false;
  }

  if (reference.targetChange.remote.state !== 'present') {
    return true;
  }

  if (reference.targetRemoteHash === reference.targetBaseHash) {
    return false;
  }

  return reference.targetLocalHash !== reference.targetRemoteHash;
}

function isSamePlanWordPressGraphCreate(reference) {
  return reference.targetChange.base.state === 'absent'
    && reference.targetChange.local.state === 'present'
    && reference.targetChange.remote.state === 'absent'
    && reference.targetChange.localChange === 'create'
    && reference.targetChange.remoteChange === 'unchanged';
}

function samePlanWordPressGraphReferenceEvidence(reference) {
  return {
    relationshipKey: reference.relationshipKey,
    relationshipType: reference.relationshipType,
    sourceResourceKey: reference.sourceResourceKey,
    sourceTable: reference.sourceTable,
    sourceRowId: reference.sourceRowId,
    targetResource: reference.targetResource,
    targetResourceKey: reference.targetResourceKey,
    targetTable: reference.targetTable,
    targetId: reference.targetId,
    targetBaseHash: reference.targetBaseHash,
    targetLocalHash: reference.targetLocalHash,
    targetRemoteHash: reference.targetRemoteHash,
    targetChange: reference.targetChange,
    resolutionPolicy: 'same-plan-local-create',
    dependency: {
      source: 'same-plan-local-create',
      targetResourceKey: reference.targetResourceKey,
      targetLocalHash: reference.targetLocalHash,
    },
  };
}

function isSupportedSamePlanTermmetaReference({
  baseValue,
  reference,
  local,
  remote,
}) {
  if (
    baseValue === ABSENT
    || reference.relationshipType !== 'termmeta-term'
    || !isSamePlanWordPressGraphCreate(reference)
  ) {
    return false;
  }

  if (normalizePositiveInteger(baseValue?.term_id) != null) {
    return false;
  }

  const targetTermId = normalizePositiveInteger(reference.targetId);
  const localNavMenuTaxonomy = [...(local?.db?.wp_term_taxonomy ? Object.values(local.db.wp_term_taxonomy) : [])]
    .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');
  const remoteNavMenuTaxonomy = [...(remote?.db?.wp_term_taxonomy ? Object.values(remote.db.wp_term_taxonomy) : [])]
    .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');

  return !localNavMenuTaxonomy && !remoteNavMenuTaxonomy;
}

function isSupportedSamePlanPostParentReference({
  baseValue,
  localValue,
  reference,
  local,
}) {
  if (
    baseValue === ABSENT
    || localValue === ABSENT
    || reference.relationshipType !== 'post-parent'
    || !isSamePlanWordPressGraphCreate(reference)
  ) {
    return false;
  }

  const targetPostId = normalizeWordPressGraphReferenceTargetIntegerId(reference);
  if (
    targetPostId == null
    || normalizePositiveInteger(baseValue?.post_parent) != null
    || normalizePositiveInteger(localValue?.post_parent) !== targetPostId
  ) {
    return false;
  }

  const targetPostType = getResource(local, reference.targetResource)?.post_type ?? 'post';
  return !['attachment', 'revision', 'nav_menu_item', 'wp_navigation'].includes(targetPostType);
}

function isSupportedSamePlanPostmetaReference({
  baseValue,
  localValue,
  reference,
  local,
}) {
  if (
    baseValue === ABSENT
    || localValue === ABSENT
    || reference.relationshipType !== 'postmeta-post'
    || !isSamePlanWordPressGraphCreate(reference)
  ) {
    return false;
  }

  const targetPostId = normalizeWordPressGraphReferenceTargetIntegerId(reference);
  if (
    targetPostId == null
    || normalizePositiveInteger(baseValue?.post_id) != null
    || normalizePositiveInteger(localValue?.post_id) !== targetPostId
  ) {
    return false;
  }

  const targetPostType = getResource(local, reference.targetResource)?.post_type ?? 'post';
  return !['attachment', 'revision', 'nav_menu_item', 'wp_navigation'].includes(targetPostType);
}

function isSupportedSamePlanTermRelationshipObjectReference({
  baseValue,
  localValue,
  reference,
  local,
}) {
  if (
    baseValue === ABSENT
    || localValue === ABSENT
    || reference.relationshipType !== 'term-relationship-object'
    || !isSamePlanWordPressGraphCreate(reference)
  ) {
    return false;
  }

  const targetPostId = normalizeWordPressGraphReferenceTargetIntegerId(reference);
  if (
    targetPostId == null
    || normalizePositiveInteger(baseValue?.object_id) !== targetPostId
    || normalizePositiveInteger(localValue?.object_id) !== targetPostId
  ) {
    return false;
  }

  const targetPostType = getResource(local, reference.targetResource)?.post_type ?? 'post';
  return !['attachment', 'revision', 'nav_menu_item', 'wp_navigation'].includes(targetPostType);
}

function isSupportedSamePlanTermTaxonomyReference({
  baseValue,
  localValue,
  reference,
  local,
  remote,
}) {
  if (
    baseValue === ABSENT
    || localValue === ABSENT
    || reference.relationshipType !== 'term-taxonomy-term'
    || !isSamePlanWordPressGraphCreate(reference)
  ) {
    return false;
  }

  const targetTermId = normalizeWordPressGraphReferenceTargetIntegerId(reference);
  if (
    targetTermId == null
    || normalizePositiveInteger(baseValue?.term_id) !== targetTermId
    || normalizePositiveInteger(localValue?.term_id) !== targetTermId
  ) {
    return false;
  }

  const localNavMenuTaxonomy = [...(local?.db?.wp_term_taxonomy ? Object.values(local.db.wp_term_taxonomy) : [])]
    .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');
  const remoteNavMenuTaxonomy = [...(remote?.db?.wp_term_taxonomy ? Object.values(remote.db.wp_term_taxonomy) : [])]
    .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');

  return !localNavMenuTaxonomy
    && !remoteNavMenuTaxonomy
    && localValue?.taxonomy !== 'nav_menu'
    && baseValue?.taxonomy !== 'nav_menu';
}

function isSupportedSamePlanTermTaxonomyParentReference({
  baseValue,
  localValue,
  reference,
  local,
  remote,
}) {
  if (
    baseValue === ABSENT
    || localValue === ABSENT
    || reference.relationshipType !== 'term-taxonomy-parent'
    || !isSamePlanWordPressGraphCreate(reference)
  ) {
    return false;
  }

  const targetTermId = normalizeWordPressGraphReferenceTargetIntegerId(reference);
  if (
    targetTermId == null
    || normalizePositiveInteger(baseValue?.parent) !== targetTermId
    || normalizePositiveInteger(localValue?.parent) !== targetTermId
  ) {
    return false;
  }

  const localNavMenuTaxonomy = [...(local?.db?.wp_term_taxonomy ? Object.values(local.db.wp_term_taxonomy) : [])]
    .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');
  const remoteNavMenuTaxonomy = [...(remote?.db?.wp_term_taxonomy ? Object.values(remote.db.wp_term_taxonomy) : [])]
    .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');

  return !localNavMenuTaxonomy
    && !remoteNavMenuTaxonomy
    && localValue?.taxonomy !== 'nav_menu'
    && baseValue?.taxonomy !== 'nav_menu';
}

function isSupportedSamePlanTermRelationshipTaxonomyReference({
  baseValue,
  localValue,
  reference,
}) {
  if (
    baseValue === ABSENT
    || localValue === ABSENT
    || reference.relationshipType !== 'term-relationship-taxonomy'
    || !isSamePlanWordPressGraphCreate(reference)
  ) {
    return false;
  }

  const targetTaxonomyId = normalizeWordPressGraphReferenceTargetIntegerId(reference);
  if (
    targetTaxonomyId == null
    || normalizePositiveInteger(baseValue?.term_taxonomy_id) !== targetTaxonomyId
    || normalizePositiveInteger(localValue?.term_taxonomy_id) !== targetTaxonomyId
  ) {
    return false;
  }

  return true;
}

function finalizeWordPressGraphDependencies(plan, local, remote) {
  const mutationByResourceKey = new Map(
    plan.mutations.map((mutation) => [mutation.resourceKey, mutation]),
  );
  const blockedTargetResourceKeys = new Set(
    plan.blockers
      .map((blocker) => blocker?.resourceKey)
      .filter(Boolean),
  );
  const blockedMutationIds = new Set();
  let blockerIndex = plan.blockers.length + 1;

  for (const mutation of plan.mutations) {
    const references = Array.isArray(mutation.wordpressGraphReferences)
      ? mutation.wordpressGraphReferences
      : [];
    if (references.length === 0) {
      continue;
    }

    const dependencyIds = new Set();
    let mutationBlocked = false;
    for (const reference of references) {
      if (reference.resolutionPolicy !== 'same-plan-local-create') {
        continue;
      }

      const targetMutation = mutationByResourceKey.get(reference.targetResourceKey);
      if (
        !isValidSamePlanWordPressGraphTarget(
          targetMutation,
          reference,
          mutationByResourceKey,
          remote,
          blockedTargetResourceKeys,
        )
      ) {
        plan.blockers.push({
          id: `blocker-wordpress-graph-dependency-${blockerIndex++}`,
          class: 'missing-wordpress-graph-dependency',
          resource: mutation.resource,
          resourceKey: mutation.resourceKey,
          reason: `WordPress graph mutation ${mutation.resourceKey} references a same-plan target without a matching supported target create mutation.`,
          resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
          references: [reference],
        });
        blockedTargetResourceKeys.add(mutation.resourceKey);
        blockedMutationIds.add(mutation.id);
        delete mutation.dependsOnMutationIds;
        mutationBlocked = true;
        break;
      }

      reference.dependency = {
        ...reference.dependency,
        targetMutationId: targetMutation.id,
        targetResourceKey: targetMutation.resourceKey,
        targetLocalHash: targetMutation.localHash,
      };
      dependencyIds.add(targetMutation.id);
    }

    if (mutationBlocked) {
      continue;
    }

    if (dependencyIds.size > 0) {
      mutation.dependsOnMutationIds = [...dependencyIds];
    } else {
      delete mutation.dependsOnMutationIds;
    }
  }

  if (blockedMutationIds.size > 0) {
    plan.mutations = plan.mutations.filter((mutation) => !blockedMutationIds.has(mutation.id));
    plan.preconditions = plan.preconditions.filter(
      (precondition) => !blockedMutationIds.has(precondition.mutationId),
    );
  }

  plan.mutations = orderMutationsByDependencies(plan.mutations);
  plan.graphDependencies = collectWordPressGraphDependencies(plan);
}

function isValidSamePlanWordPressGraphTarget(
  targetMutation,
  reference,
  mutationByResourceKey,
  remote,
  blockedTargetResourceKeys,
) {
  if (
    !targetMutation
    || targetMutation.action !== 'put'
    || targetMutation.changeKind !== 'create'
    || targetMutation.resourceKey !== reference.targetResourceKey
    || targetMutation.localHash !== reference.targetLocalHash
    || blockedTargetResourceKeys.has(targetMutation.resourceKey)
  ) {
    return false;
  }

  if (targetMutation.resource?.type !== 'row') {
    return false;
  }

  const supportsTermTarget = targetMutation.resource.table === 'wp_terms' && (
    reference.relationshipType === 'termmeta-term'
    && reference.sourceTable === 'wp_termmeta'
  ) || (
    reference.relationshipType === 'term-taxonomy-term'
    && reference.sourceTable === 'wp_term_taxonomy'
  ) || (
    reference.relationshipType === 'term-taxonomy-parent'
    && reference.sourceTable === 'wp_term_taxonomy'
  );
  const supportsPostTarget = targetMutation.resource.table === 'wp_posts'
    && (
      (
        reference.relationshipType === 'post-parent'
        && reference.sourceTable === 'wp_posts'
      )
      || (
      (
        reference.relationshipType === 'postmeta-post'
        && reference.sourceTable === 'wp_postmeta'
      )
      || (
        reference.relationshipType === 'term-relationship-object'
        && reference.sourceTable === 'wp_term_relationships'
      )
      )
    );
  const supportsTermTaxonomyTarget = targetMutation.resource.table === 'wp_term_taxonomy'
    && reference.relationshipType === 'term-relationship-taxonomy'
    && reference.sourceTable === 'wp_term_relationships';
  if (!supportsTermTarget && !supportsPostTarget && !supportsTermTaxonomyTarget) {
    return false;
  }

  const targetValue = deserializeResourceValue(targetMutation.value);
  if (!targetValue || typeof targetValue !== 'object') {
    return false;
  }

  if (targetMutation.resource.table === 'wp_terms') {
    const ownerTermTaxonomy = [...mutationByResourceKey.values()].find((candidate) => {
      if (candidate.resource?.type !== 'row' || candidate.resource.table !== 'wp_term_taxonomy') {
        return false;
      }
      const candidateValue = deserializeResourceValue(candidate.value);
      return candidateValue
        && typeof candidateValue === 'object'
        && normalizePositiveInteger(candidateValue.term_id) === normalizePositiveInteger(targetValue.term_id)
        && candidateValue.taxonomy === 'nav_menu';
    });
    const remoteTermTaxonomy = [...(remote?.db?.wp_term_taxonomy ? Object.values(remote.db.wp_term_taxonomy) : [])]
      .find((candidate) => normalizePositiveInteger(candidate?.term_id) === normalizePositiveInteger(targetValue.term_id)
        && candidate?.taxonomy === 'nav_menu');
    if (ownerTermTaxonomy || remoteTermTaxonomy) {
      return false;
    }
  }

  if (
    targetMutation.resource.table === 'wp_posts'
    && ['attachment', 'revision', 'nav_menu_item', 'wp_navigation'].includes(
      targetValue.post_type ?? 'post',
    )
  ) {
    return false;
  }

  if (targetMutation.resource.table === 'wp_term_taxonomy' && targetValue.taxonomy === 'nav_menu') {
    return false;
  }

  return true;
}

function orderMutationsByDependencies(mutations) {
  const mutationById = new Map(mutations.map((mutation) => [mutation.id, mutation]));
  const remaining = new Set(mutations.map((mutation) => mutation.id));
  const ordered = [];

  while (remaining.size > 0) {
    let progressed = false;
    for (const mutation of mutations) {
      if (!remaining.has(mutation.id)) {
        continue;
      }
      const dependencies = (mutation.dependsOnMutationIds || [])
        .filter((dependencyId) => mutationById.has(dependencyId));
      if (dependencies.some((dependencyId) => remaining.has(dependencyId))) {
        continue;
      }
      ordered.push(mutation);
      remaining.delete(mutation.id);
      progressed = true;
    }
    if (!progressed) {
      return mutations;
    }
  }

  return ordered;
}

function collectWordPressGraphDependencies(plan) {
  const mutationById = new Map(
    (Array.isArray(plan.mutations) ? plan.mutations : [])
      .map((mutation) => [mutation.id, mutation]),
  );
  const dependencies = [];

  for (const mutation of Array.isArray(plan.mutations) ? plan.mutations : []) {
    const references = Array.isArray(mutation.wordpressGraphReferences)
      ? mutation.wordpressGraphReferences
      : [];
    for (const reference of references) {
      const dependency = reference?.dependency;
      if (
        reference?.resolutionPolicy !== 'same-plan-local-create'
        || !dependency
        || dependency.source !== 'same-plan-local-create'
        || typeof dependency.targetMutationId !== 'string'
        || !mutationById.has(dependency.targetMutationId)
      ) {
        continue;
      }

      dependencies.push({
        sourceMutationId: mutation.id,
        sourceResourceKey: mutation.resourceKey,
        relationshipKey: reference.relationshipKey,
        relationshipType: reference.relationshipType,
        targetMutationId: dependency.targetMutationId,
        targetResourceKey: dependency.targetResourceKey,
        resolutionPolicy: reference.resolutionPolicy,
        source: dependency.source,
        targetLocalHash: dependency.targetLocalHash,
      });
    }
  }

  return dependencies;
}

function wordpressGraphReferences(resource, value) {
  const suffix = wordpressGraphTableSuffix(resource.table);
  if (!suffix || !value || typeof value !== 'object') {
    return [];
  }

  const references = [];
  const addReference = ({ field, relationshipType, targetTable, targetId }) => {
    const normalizedId = normalizePositiveInteger(targetId);
    if (normalizedId == null) {
      return;
    }
    const targetResource = wordpressGraphTargetResource({
      sourceTable: resource.table,
      targetSuffix: targetTable,
      id: normalizedId,
    });
    references.push({
      relationshipKey: `${resource.table}.${field}`,
      relationshipType,
      sourceResourceKey: resource.key,
      sourceTable: resource.table,
      sourceRowId: resource.id,
      targetTable: targetResource.table,
      targetId: targetResource.id,
      targetResource,
      targetResourceKey: targetResource.key,
    });
  };

  if (suffix === 'posts') {
    addReference({
      field: 'post_parent',
      relationshipType: 'post-parent',
      targetTable: 'posts',
      targetId: value.post_parent,
    });
    addReference({
      field: 'post_author',
      relationshipType: 'post-author',
      targetTable: 'users',
      targetId: value.post_author,
    });
    if (value.post_type === 'nav_menu_item') {
      addReference({
        field: 'menu_item_parent',
        relationshipType: 'menu-item-parent',
        targetTable: 'posts',
        targetId: value.menu_item_parent,
      });
    }
  }

  if (suffix === 'comments') {
    addReference({
      field: 'comment_parent',
      relationshipType: 'comment-parent',
      targetTable: 'comments',
      targetId: value.comment_parent,
    });
    addReference({
      field: 'comment_post_ID',
      relationshipType: 'comment-post',
      targetTable: 'posts',
      targetId: value.comment_post_ID,
    });
    addReference({
      field: 'user_id',
      relationshipType: 'comment-user',
      targetTable: 'users',
      targetId: value.user_id,
    });
  }

  if (suffix === 'commentmeta') {
    addReference({
      field: 'comment_id',
      relationshipType: 'commentmeta-comment',
      targetTable: 'comments',
      targetId: value.comment_id,
    });
  }

  if (suffix === 'postmeta') {
    addReference({
      field: 'post_id',
      relationshipType: 'postmeta-post',
      targetTable: 'posts',
      targetId: value.post_id,
    });
    if (value.meta_key === '_thumbnail_id') {
      addReference({
        field: 'meta_value',
        relationshipType: 'featured-image-attachment',
        targetTable: 'posts',
        targetId: value.meta_value,
      });
    }
  }

  if (suffix === 'term_relationships') {
    addReference({
      field: 'object_id',
      relationshipType: 'term-relationship-object',
      targetTable: 'posts',
      targetId: value.object_id,
    });
    addReference({
      field: 'term_taxonomy_id',
      relationshipType: 'term-relationship-taxonomy',
      targetTable: 'term_taxonomy',
      targetId: value.term_taxonomy_id,
    });
  }

  if (suffix === 'term_taxonomy') {
    addReference({
      field: 'term_id',
      relationshipType: 'term-taxonomy-term',
      targetTable: 'terms',
      targetId: value.term_id,
    });
    addReference({
      field: 'parent',
      relationshipType: 'term-taxonomy-parent',
      targetTable: 'terms',
      targetId: value.parent,
    });
  }

  if (suffix === 'termmeta') {
    addReference({
      field: 'term_id',
      relationshipType: 'termmeta-term',
      targetTable: 'terms',
      targetId: value.term_id,
    });
  }

  if (suffix === 'usermeta') {
    addReference({
      field: 'user_id',
      relationshipType: 'usermeta-user',
      targetTable: 'users',
      targetId: value.user_id,
    });
  }

  return references;
}

function wordpressGraphReferenceEvidence(reference, resources, base, local, remote) {
  const target = resources.find((candidate) => candidate.key === reference.targetResourceKey)
    || reference.targetResource;
  const baseValue = getResource(base, target);
  const localValue = getResource(local, target);
  const remoteValue = getResource(remote, target);
  const targetBaseHash = resourceHash(base, target);
  const targetLocalHash = resourceHash(local, target);
  const targetRemoteHash = resourceHash(remote, target);

  return {
    relationshipKey: reference.relationshipKey,
    relationshipType: reference.relationshipType,
    sourceResourceKey: reference.sourceResourceKey,
    sourceTable: reference.sourceTable,
    sourceRowId: reference.sourceRowId,
    targetResource: target,
    targetResourceKey: target.key,
    targetTable: target.table,
    targetId: target.id,
    targetBaseHash,
    targetLocalHash,
    targetRemoteHash,
    targetChange: changeEvidence(
      target,
      baseValue,
      localValue,
      remoteValue,
      targetBaseHash,
      targetLocalHash,
      targetRemoteHash,
    ),
  };
}

function compareReferenceEvidenceByPriority(priorityMap, left, right) {
  const leftPriority = priorityMap.get(left.relationshipType) ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = priorityMap.get(right.relationshipType) ?? Number.MAX_SAFE_INTEGER;
  return (leftPriority - rightPriority)
    || left.sourceResourceKey.localeCompare(right.sourceResourceKey)
    || left.relationshipType.localeCompare(right.relationshipType)
    || left.relationshipKey.localeCompare(right.relationshipKey);
}

function samePlanCreatedGraphIdentitySupport({ resource, resources, base, local, remote }) {
  const localValue = getResource(local, resource);
  const baseValue = getResource(base, resource);
  const remoteValue = getResource(remote, resource);

  if (localValue === ABSENT || resource.type !== 'row') {
    return { supported: true };
  }

  if (resourceHash(base, resource) !== resourceHash(remote, resource)) {
    return { supported: true };
  }

  const inboundReferences = [];
  for (const sourceResource of resources) {
    if (!isWordPressGraphReferenceResource(sourceResource)) {
      continue;
    }
    const sourceLocalValue = getResource(local, sourceResource);
    if (sourceLocalValue === ABSENT) {
      continue;
    }
    if (resourceHash(base, sourceResource) === resourceHash(local, sourceResource)) {
      continue;
    }

    for (const reference of wordpressGraphReferences(sourceResource, sourceLocalValue)) {
      if (reference.targetResourceKey !== resource.key) {
        continue;
      }
      const evidence = wordpressGraphReferenceEvidence(reference, resources, base, local, remote);
      if (
        resource.table === 'wp_posts'
        && sourceResource.table === 'wp_postmeta'
        && isSupportedSamePlanPostmetaReference({
          baseValue: getResource(base, sourceResource),
          localValue: sourceLocalValue,
          reference: evidence,
          local,
        })
      ) {
        continue;
      }
      if (
        resource.table === 'wp_posts'
        && sourceResource.table === 'wp_posts'
        && isSupportedSamePlanPostParentReference({
          baseValue: getResource(base, sourceResource),
          localValue: sourceLocalValue,
          reference: evidence,
          local,
        })
        && !wordpressGraphReferences(sourceResource, sourceLocalValue)
          .map((sourceReference) =>
            wordpressGraphReferenceEvidence(sourceReference, resources, base, local, remote))
          .some((sourceReferenceEvidence) =>
            sourceReferenceEvidence.targetChange.remote.state === 'absent'
            && sourceReferenceEvidence.targetChange.local.state === 'present'
            && (
              sourceReferenceEvidence.relationshipType !== 'post-parent'
              || !isSupportedSamePlanPostParentReference({
                baseValue: getResource(base, sourceResource),
                localValue: sourceLocalValue,
                reference: sourceReferenceEvidence,
                local,
              })
            ))
      ) {
        continue;
      }
      if (
        resource.table === 'wp_posts'
        && sourceResource.table === 'wp_term_relationships'
        && isSupportedSamePlanTermRelationshipObjectReference({
          baseValue: getResource(base, sourceResource),
          localValue: sourceLocalValue,
          reference: evidence,
          local,
        })
        && !wordpressGraphReferences(sourceResource, sourceLocalValue)
          .map((sourceReference) =>
            wordpressGraphReferenceEvidence(sourceReference, resources, base, local, remote))
          .some((sourceReferenceEvidence) =>
            sourceReferenceEvidence.targetChange.remote.state === 'absent'
            && sourceReferenceEvidence.targetChange.local.state === 'present'
            && (
              (
                sourceReferenceEvidence.relationshipType !== 'term-relationship-object'
                || !isSupportedSamePlanTermRelationshipObjectReference({
                  baseValue: getResource(base, sourceResource),
                  localValue: sourceLocalValue,
                  reference: sourceReferenceEvidence,
                  local,
                })
              )
              && (
                sourceReferenceEvidence.relationshipType !== 'term-relationship-taxonomy'
                || !isSupportedSamePlanTermRelationshipTaxonomyReference({
                  baseValue: getResource(base, sourceResource),
                  localValue: sourceLocalValue,
                  reference: sourceReferenceEvidence,
                })
                || !unsupportedTermTaxonomyResourceSupport({
                  resource: sourceReferenceEvidence.targetResource,
                  baseValue: getResource(base, sourceReferenceEvidence.targetResource),
                  localValue: getResource(local, sourceReferenceEvidence.targetResource),
                  remoteValue: getResource(remote, sourceReferenceEvidence.targetResource),
                  resources,
                  base,
                  local,
                  remote,
                }).supported
              )
            ))
      ) {
        continue;
      }
      if (
        resource.table === 'wp_terms'
        && sourceResource.table === 'wp_termmeta'
        && isSupportedSamePlanTermmetaReference({
          baseValue: getResource(base, sourceResource),
          reference: evidence,
          local,
          remote,
        })
      ) {
        continue;
      }
      if (
        resource.table === 'wp_terms'
        && sourceResource.table === 'wp_term_taxonomy'
        && (
          isSupportedSamePlanTermTaxonomyReference({
            baseValue: getResource(base, sourceResource),
            localValue: sourceLocalValue,
            reference: evidence,
            local,
            remote,
          })
          || isSupportedSamePlanTermTaxonomyParentReference({
            baseValue: getResource(base, sourceResource),
            localValue: sourceLocalValue,
            reference: evidence,
            local,
            remote,
          })
        )
        && !wordpressGraphReferences(sourceResource, sourceLocalValue)
          .map((sourceReference) =>
            wordpressGraphReferenceEvidence(sourceReference, resources, base, local, remote))
          .some((sourceReferenceEvidence) =>
            sourceReferenceEvidence.targetChange.remote.state === 'absent'
            && sourceReferenceEvidence.targetChange.local.state === 'present'
            && (
              (
                sourceReferenceEvidence.relationshipType !== 'term-taxonomy-term'
                || !isSupportedSamePlanTermTaxonomyReference({
                  baseValue: getResource(base, sourceResource),
                  localValue: sourceLocalValue,
                  reference: sourceReferenceEvidence,
                  local,
                  remote,
                })
              )
              && (
                sourceReferenceEvidence.relationshipType !== 'term-taxonomy-parent'
                || !isSupportedSamePlanTermTaxonomyParentReference({
                  baseValue: getResource(base, sourceResource),
                  localValue: sourceLocalValue,
                  reference: sourceReferenceEvidence,
                  local,
                  remote,
                })
              )
            ))
      ) {
        continue;
      }
      if (
        resource.table === 'wp_term_taxonomy'
        && sourceResource.table === 'wp_term_relationships'
        && isSupportedSamePlanTermRelationshipTaxonomyReference({
          baseValue: getResource(base, sourceResource),
          localValue: sourceLocalValue,
          reference: evidence,
        })
        && unsupportedTermTaxonomyResourceSupport({
          resource,
          baseValue,
          localValue,
          remoteValue,
          resources,
          base,
          local,
          remote,
        }).supported
      ) {
        continue;
      }
      if (evidence.targetChange.remote.state === 'absent') {
        inboundReferences.push(evidence);
      }
    }
  }

  if (inboundReferences.length === 0) {
    return { supported: true };
  }

  const orderedInboundReferences = inboundReferences.slice().sort((left, right) => {
    const priorityDelta = samePlanCreatedGraphIdentityReferencePriority(left)
      - samePlanCreatedGraphIdentityReferencePriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.sourceResourceKey.localeCompare(right.sourceResourceKey)
      || left.relationshipType.localeCompare(right.relationshipType)
      || left.relationshipKey.localeCompare(right.relationshipKey);
  });

  return {
    supported: false,
    className: 'stale-wordpress-graph-identity',
    reason: samePlanCreatedGraphIdentityReason(resource, orderedInboundReferences[0]),
    references: orderedInboundReferences,
  };
}

function samePlanCreatedGraphIdentityReferencePriority(reference) {
  if (reference.relationshipType === 'term-relationship-taxonomy'
    && reference.targetResource?.table === 'wp_term_taxonomy') {
    return 0;
  }
  if (reference.relationshipType === 'term-taxonomy-parent'
    && reference.targetResource?.table === 'wp_terms') {
    return 1;
  }
  if (reference.relationshipType === 'term-taxonomy-term'
    && reference.targetResource?.table === 'wp_terms') {
    return 2;
  }
  if (reference.relationshipType === 'term-relationship-object'
    && reference.targetResource?.table === 'wp_posts'
    && reference.targetChange.local.value?.post_type === 'revision') {
    return 3;
  }
  if (reference.relationshipType === 'post-parent'
    && reference.targetResource?.table === 'wp_posts') {
    return 4;
  }
  if (reference.relationshipType === 'comment-post'
    && reference.targetResource?.table === 'wp_posts') {
    return 5;
  }
  if (reference.relationshipType === 'term-relationship-object'
    && reference.targetResource?.table === 'wp_posts') {
    return 6;
  }
  if (reference.relationshipType === 'postmeta-post'
    && reference.targetResource?.table === 'wp_posts') {
    return 7;
  }
  if (reference.relationshipType === 'post-author'
    && reference.targetResource?.table === 'wp_users') {
    return 8;
  }
  if (reference.relationshipType === 'featured-image-attachment'
    && reference.targetResource?.table === 'wp_posts'
    && reference.targetChange.local.value?.post_type === 'attachment') {
    return 9;
  }
  if (reference.relationshipType === 'comment-parent'
    && reference.targetResource?.table === 'wp_comments') {
    return 10;
  }
  if (reference.relationshipType === 'comment-user'
    && reference.targetResource?.table === 'wp_users') {
    return 11;
  }
  if (reference.relationshipType === 'commentmeta-comment'
    && reference.targetResource?.table === 'wp_comments') {
    return 12;
  }
  if (reference.relationshipType === 'usermeta-user'
    && reference.targetResource?.table === 'wp_users') {
    return 13;
  }
  return Number.MAX_SAFE_INTEGER;
}

function samePlanCreatedGraphIdentityReason(resource, reference) {
  if (!reference) {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a relationship that depends on it, and identity rewriting is not yet supported.`;
  }

  if (reference.relationshipType === 'term-relationship-taxonomy'
    && reference.targetResource?.table === 'wp_term_taxonomy') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship taxonomy target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'term-taxonomy-parent'
    && reference.targetResource?.table === 'wp_terms') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a parent term identity that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'term-taxonomy-term'
    && reference.targetResource?.table === 'wp_terms') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a term identity that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'termmeta-term'
    && reference.targetResource?.table === 'wp_terms') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a term meta target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'term-relationship-object'
    && reference.targetResource?.table === 'wp_posts'
    && reference.targetChange.local.value?.post_type === 'revision') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship revision target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'post-parent'
    && reference.targetResource?.table === 'wp_posts') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a post parent target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'comment-post'
    && reference.targetResource?.table === 'wp_posts') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a comment post target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'term-relationship-object'
    && reference.targetResource?.table === 'wp_posts') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship post target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'postmeta-post'
    && reference.targetResource?.table === 'wp_posts') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a post meta target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'post-author'
    && reference.targetResource?.table === 'wp_users') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a post author target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'featured-image-attachment'
    && reference.targetResource?.table === 'wp_posts'
    && reference.targetChange.local.value?.post_type === 'attachment') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a featured image attachment target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'comment-parent'
    && reference.targetResource?.table === 'wp_comments') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a comment parent target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'comment-user'
    && reference.targetResource?.table === 'wp_users') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a comment user target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'commentmeta-comment'
    && reference.targetResource?.table === 'wp_comments') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a comment meta target that depends on it, and identity rewriting is not yet supported.`;
  }
  if (reference.relationshipType === 'usermeta-user'
    && reference.targetResource?.table === 'wp_users') {
    return `WordPress graph mutation ${resource.key} is created in the same plan as a user meta target that depends on it, and identity rewriting is not yet supported.`;
  }

  return `WordPress graph mutation ${resource.key} is created in the same plan as a relationship that depends on it, and identity rewriting is not yet supported.`;
}

function isWordPressGraphReferenceResource(resource) {
  if (resource.type !== 'row') {
    return false;
  }
  return [
    'wp_commentmeta',
    'wp_comments',
    'wp_posts',
    'wp_postmeta',
    'wp_term_relationships',
    'wp_term_taxonomy',
    'wp_termmeta',
  ].includes(resource.table);
}

function wordpressGraphTargetResource({ sourceTable, targetSuffix, id }) {
  const table = wordpressGraphSiblingTable(sourceTable, targetSuffix);
  const idField = wordpressGraphPrimaryIdField(targetSuffix);
  const rowId = `${idField}:${id}`;
  return {
    type: 'row',
    table,
    id: rowId,
    key: `row:${JSON.stringify([table, rowId])}`,
  };
}

function wordpressGraphSiblingTable(table, targetSuffix) {
  const sourceSuffix = wordpressGraphTableSuffix(table);
  if (!sourceSuffix) {
    return `wp_${targetSuffix}`;
  }
  return `${table.slice(0, table.length - sourceSuffix.length)}${targetSuffix}`;
}

function wordpressGraphTableSuffix(table) {
  return WORDPRESS_GRAPH_TABLE_SUFFIXES.find((suffix) =>
    table === `wp_${suffix}` || table.endsWith(`_${suffix}`)) || null;
}

function wordpressGraphPrimaryIdField(suffix) {
  if (suffix === 'posts') {
    return 'ID';
  }
  if (suffix === 'comments') {
    return 'comment_ID';
  }
  if (suffix === 'commentmeta') {
    return 'meta_id';
  }
  if (suffix === 'users') {
    return 'ID';
  }
  if (suffix === 'usermeta') {
    return 'umeta_id';
  }
  if (suffix === 'terms') {
    return 'term_id';
  }
  if (suffix === 'term_taxonomy') {
    return 'term_taxonomy_id';
  }
  return 'id';
}

function normalizePositiveInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

function normalizeWordPressGraphReferenceTargetIntegerId(reference) {
  const directId = normalizePositiveInteger(reference?.targetId);
  if (directId != null) {
    return directId;
  }
  const rowId = reference?.targetResource?.id;
  if (typeof rowId === 'string') {
    const match = rowId.match(/:(\d+)$/);
    if (match) {
      return normalizePositiveInteger(match[1]);
    }
  }
  return null;
}

function isPluginContextMutationResource(resource, owner) {
  return Boolean(owner)
    && (resource.type === 'plugin' || (resource.type === 'file' && isPluginOwnerContextResource(resource, owner)));
}

function pluginContextMutationSupport({
  resource,
  owner,
  resources,
  base,
  local,
  remote,
}) {
  const staleContext = pluginOwnerContextEvidence({
    owner,
    resources,
    base,
    local,
    remote,
  })
    .filter((context) => context.resourceKey !== resource.key)
    .filter((context) =>
      context.remoteHash !== context.baseHash
      && context.localHash !== context.remoteHash);

  if (staleContext.length === 0) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'stale-plugin-owner-context',
    reason: `Plugin context resource ${resource.key} cannot be applied because live remote plugin context for ${owner} changed since the pull base.`,
    ownerContext: staleContext,
  };
}

function pluginOwnedOwnerContextSupport({
  resource,
  owner,
  resources,
  base,
  local,
  remote,
  intents,
  intentByResource,
}) {
  const intentId = intentByResource.get(resource.key) || null;
  const intent = intentId
    ? intents.find((candidate) => candidate.id === intentId)
    : null;
  const ownerDependencyDeclared = intentDeclaresPluginDependency(intent, owner);
  const ownerPluginIncludedInIntent = intentIncludesPluginResource(intent, owner);
  if (ownerDependencyDeclared && !hasPlugin(remote, owner) && ownerPluginIncludedInIntent) {
    return { supported: true };
  }

  const staleContext = pluginOwnerContextEvidence({
    owner,
    resources,
    base,
    local,
    remote,
  })
    .filter((candidate) => !(ownerDependencyDeclared && candidate.type === 'plugin'))
    .filter((context) =>
      context.remoteHash !== context.baseHash
      && context.localHash !== context.remoteHash);

  if (staleContext.length === 0) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'stale-plugin-owner-context',
    reason: `Plugin-owned resource ${resource.key} cannot be applied because live remote plugin context for ${owner} changed since the pull base.`,
    ownerContext: staleContext,
  };
}

function pluginOwnerContextEvidence({
  owner,
  resources,
  base,
  local,
  remote,
}) {
  return resources
    .filter((candidate) => isPluginOwnerContextResource(candidate, owner))
    .map((contextResource) => {
      const baseValue = getResource(base, contextResource);
      const localValue = getResource(local, contextResource);
      const remoteValue = getResource(remote, contextResource);
      const baseHash = resourceHash(base, contextResource);
      const localHash = resourceHash(local, contextResource);
      const remoteHash = resourceHash(remote, contextResource);
      return {
        resource: contextResource,
        type: contextResource.type,
        resourceKey: contextResource.key,
        baseHash,
        localHash,
        remoteHash,
        change: changeEvidence(
          contextResource,
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        ),
      };
    });
}

function isPluginOwnerContextResource(resource, owner) {
  if (resource.type === 'plugin') {
    return resource.name === owner;
  }
  return resource.type === 'file' && pluginOwnerFor(resource) === owner;
}

function intentDeclaresPluginDependency(intent, plugin) {
  if (!intent) {
    return false;
  }
  return normalizePluginDependencies(intent.dependencies?.plugins || [])
    .some((dependency) => dependency.name === plugin);
}

function intentIncludesPluginResource(intent, plugin) {
  if (!intent) {
    return false;
  }
  return Array.isArray(intent.resources)
    && intent.resources.some((resourceKey) => resourceKey === `plugin:${plugin}`);
}

function classifyUnsupportedDriftState({ baseValue, localValue, remoteValue, allowSteadyUnsupported = false }) {
  const remoteOnlyDrift = (
    stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) !== stableStringify(baseValue)
  );
  const convergedDrift = (
    localValue !== ABSENT
    && remoteValue !== ABSENT
    && stableStringify(localValue) === stableStringify(remoteValue)
    && stableStringify(localValue) !== stableStringify(baseValue)
  );
  const steadyUnsupported = allowSteadyUnsupported
    && stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) === stableStringify(baseValue);

  return localValue === ABSENT
    ? 'delete'
    : convergedDrift
      ? 'converged-drift'
      : remoteOnlyDrift
        ? 'remote-only-drift'
        : steadyUnsupported
          ? 'steady-unsupported'
          : 'local-or-divergent-drift';
}

function addPluginOwnedResourceBlocker(plan, {
  resource,
  owner,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const className = support.className || 'unsupported-plugin-owned-resource';
  const resourceKind = support.resourceKind || (className === 'missing-plugin-driver'
    ? (resource.type === 'row' && typeof resource.table === 'string' && !PLUGIN_DATA_DRIVER_TABLE_NAMES.has(resource.table)
      ? 'custom-table'
      : resource.type)
    : null);
  const reason = support.reason || (className === 'missing-plugin-driver'
    ? `Plugin-owned resource ${resource.key} is missing explicit driver metadata for plugin ${owner}.`
    : `Plugin-owned resource ${resource.key} is not covered by a supported resource driver policy for plugin ${owner}.`);
  const ownerContext = boundEvidenceList(support.ownerContext || [], 3);

  plan.blockers.push({
    id: `blocker-plugin-owned-resource-${plan.blockers.length + 1}`,
    class: className,
    resource,
    resourceKey: resource.key,
    pluginOwner: owner,
    resourceKind,
    driver: support.driver || null,
    policySource: support.policySource || null,
    unsupportedState: support.unsupportedState || classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: Boolean(support.allowSteadyUnsupported),
    }),
    ...(ownerContext.length > 0 ? { ownerContext, ownerContextTruncated: Boolean((support.ownerContext || []).length > ownerContext.length) } : {}),
    reason,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
    references: support.references || [],
  });
}

function addPluginContextBlocker(plan, {
  resource,
  owner,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const ownerContext = boundEvidenceList(support.ownerContext || [], 3);
  plan.blockers.push({
    id: `blocker-plugin-context-${plan.blockers.length + 1}`,
    class: support.className || 'stale-plugin-owner-context',
    resource,
    resourceKey: resource.key,
    pluginOwner: owner,
    ownerContext,
    ownerContextTruncated: Boolean((support.ownerContext || []).length > ownerContext.length),
    unsupportedState: support.unsupportedState || classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
    }),
    reason: support.reason || `Plugin context resource ${resource.key} cannot be applied with stale live remote plugin context.`,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
    references: support.references || [],
  });
}

function addWordPressGraphIdentityBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-wordpress-graph-identity-${plan.blockers.length + 1}`,
    class: support.className || 'stale-wordpress-graph-identity',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `WordPress graph mutation ${resource.key} requires proven identity mapping and reference rewriting.`,
    resolutionPolicy: 'preserve-remote-wordpress-graph-and-stop',
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
  });
}

function addUnsupportedNavigationResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-unsupported-navigation-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-navigation-resource',
    resourceKind: 'navigation',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Navigation and menu graph resource ${resource.key} is not yet supported by the planner.`,
    unsupportedState: support.unsupportedState || null,
    baseHash,
    localHash,
    remoteHash,
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedAttachmentResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-unsupported-attachment-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-attachment-resource',
    resourceKind: 'attachment',
    resource,
    resourceKey: resource.key,
    unsupportedState: support.unsupportedState || null,
    reason: support.reason || `Attachment graph resource ${resource.key} is not yet supported by the planner.`,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
  });
}

function addUnsupportedRevisionResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-unsupported-revision-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-revision-resource',
    resourceKind: 'revision',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Revision graph resource ${resource.key} is not yet supported by the planner.`,
    unsupportedState: support.unsupportedState || null,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
  });
}

function addUnsupportedTermmetaResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-termmeta-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-termmeta-resource',
    resourceKind: 'term-meta',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Term meta graph resource ${resource.key} is not yet supported by the planner.`,
    unsupportedState: support.unsupportedState || null,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedTermTaxonomyResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-unsupported-term-taxonomy-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-term-taxonomy-resource',
    resourceKind: 'term-taxonomy',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Term taxonomy graph resource ${resource.key} is not yet supported by the planner.`,
    unsupportedState: support.unsupportedState || null,
    baseHash,
    localHash,
    remoteHash,
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedCommentsUsersResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-unsupported-comments-users-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-comments-users-resource',
    resourceKind: 'comments-users',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Comments and users graph resource ${resource.key} is not yet supported by the planner.`,
    unsupportedState: support.unsupportedState || null,
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedCommentmetaResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-unsupported-commentmeta-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-commentmeta-resource',
    resourceKind: 'comment-meta',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `Comment meta resource ${resource.key} is not yet supported by the planner.`,
    unsupportedState: support.unsupportedState || null,
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedUsermetaResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  const references = boundEvidenceList(support.references || [], 3);
  plan.blockers.push({
    id: `blocker-unsupported-usermeta-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-usermeta-resource',
    resourceKind: 'user-meta',
    resource,
    resourceKey: resource.key,
    reason: support.reason || `User meta resource ${resource.key} is not yet supported by the planner.`,
    unsupportedState: support.unsupportedState || null,
    references,
    referencesTruncated: Boolean((support.references || []).length > references.length),
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedLegacyLinksResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-legacy-links-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-legacy-links-resource',
    resourceKind: 'legacy-link',
    resource,
    resourceKey: resource.key,
    unsupportedState: support.unsupportedState || null,
    reason: support.reason || `Legacy link resource ${resource.key} is not yet supported by the planner.`,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedGuidResourceBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-guid-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-guid-resource',
    resourceKind: 'post-guid',
    resource,
    resourceKey: resource.key,
    unsupportedState: support.unsupportedState || null,
    reason: support.reason || `Post GUID resource ${resource.key} is not yet supported by the planner.`,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedSerializedBlocksBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-serialized-blocks-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-serialized-blocks-resource',
    resourceKind: 'serialized-blocks',
    resource,
    resourceKey: resource.key,
    unsupportedState: support.unsupportedState || null,
    reason: support.reason || `Serialized block references in ${resource.key} are not yet supported by the planner.`,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function addUnsupportedSpecialFileBlocker(plan, {
  resource,
  support,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  plan.blockers.push({
    id: `blocker-unsupported-special-file-resource-${plan.blockers.length + 1}`,
    class: support.className || 'unsupported-special-file-resource',
    resourceKind: 'special-file',
    resource,
    resourceKey: resource.key,
    unsupportedState: support.unsupportedState || null,
    reason: support.reason || `Special file entry ${resource.key} is not yet supported by the planner.`,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
  });
}

function boundEvidenceList(items, limit) {
  return items.slice(0, limit);
}

function addConflict(plan, {
  resource,
  reason,
  resolutionPolicy,
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
  owner,
  className = conflictClass(resource, owner),
  relatedResource = null,
  relatedChange = null,
}) {
  plan.conflicts.push({
    id: `conflict-${plan.conflicts.length + 1}`,
    resource,
    resourceKey: resource.key,
    class: className,
    pluginOwner: owner,
    reason,
    resolutionPolicy,
    baseHash,
    localHash,
    remoteHash,
    change: changeEvidence(
      resource,
      baseValue,
      localValue,
      remoteValue,
      baseHash,
      localHash,
      remoteHash,
    ),
    relatedResource,
    relatedResourceKey: relatedResource?.key,
    relatedChange,
  });
}

function unsupportedNavigationResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type === 'row' && resource.table === 'wp_postmeta') {
    const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
    if (!candidate || candidate === ABSENT) {
      return { supported: true };
    }

    const ownerPostId = normalizePositiveInteger(candidate.post_id);
    if (ownerPostId == null) {
      return { supported: true };
    }

    const navigationTarget = wordpressGraphTargetResource({
      sourceTable: resource.table,
      targetSuffix: 'posts',
      id: ownerPostId,
    });
    const navigationTargetBaseValue = getResource(base, navigationTarget);
    const navigationTargetLocalValue = getResource(local, navigationTarget);
    const navigationTargetRemoteValue = getResource(remote, navigationTarget);
    const navigationCandidate = navigationTargetLocalValue !== ABSENT
      ? navigationTargetLocalValue
      : (navigationTargetBaseValue !== ABSENT ? navigationTargetBaseValue : navigationTargetRemoteValue);

    if (
      !navigationCandidate
      || navigationCandidate === ABSENT
      || !['wp_navigation', 'nav_menu_item'].includes(navigationCandidate.post_type)
    ) {
      return { supported: true };
    }

    const navigationReference = wordpressGraphReferenceEvidence({
      relationshipKey: 'wp_postmeta.post_id',
      relationshipType: 'postmeta-post',
      sourceResourceKey: resource.key,
      sourceTable: resource.table,
      sourceRowId: resource.id,
      targetResource: navigationTarget,
      targetResourceKey: navigationTarget.key,
      targetTable: navigationTarget.table,
      targetId: navigationTarget.id,
    }, resources, base, local, remote);
    const samePlanNavigationTarget = navigationReference.targetChange.remote.state === 'absent'
      && navigationReference.targetChange.local.state === 'present';

    return {
      supported: false,
      className: 'unsupported-navigation-resource',
      unsupportedState: localValue === ABSENT
        ? 'delete'
        : samePlanNavigationTarget
          ? 'same-plan-reference'
          : classifyUnsupportedDriftState({
            baseValue,
            localValue,
            remoteValue,
            allowSteadyUnsupported: true,
          }),
      reason: samePlanNavigationTarget
        ? `WordPress graph mutation ${resource.key} references a navigation identity without proven identity mapping or reference rewriting.`
        : localValue === ABSENT
          ? 'Navigation and menu graph resource deletes are not yet supported by the planner.'
          : 'Navigation and menu graph resources are not yet supported by the planner.',
      references: [navigationReference],
    };
  }

  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (
    !candidate
    || candidate === ABSENT
    || !['wp_navigation', 'nav_menu_item'].includes(candidate.post_type)
  ) {
    return { supported: true };
  }

  const inboundReferences = resources
    .filter((sourceResource) => sourceResource.type === 'row')
    .flatMap((sourceResource) => {
      const sourceLocalValue = getResource(local, sourceResource);
      if (sourceLocalValue === ABSENT) {
        return [];
      }
      return wordpressGraphReferences(sourceResource, sourceLocalValue)
        .filter((reference) => reference.targetResourceKey === resource.key)
        .map((reference) =>
          wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
    })
    .filter((reference) =>
      reference.relationshipType === 'menu-item-parent'
      || reference.relationshipType === 'post-parent');

  const samePlanNavigationReferences = inboundReferences.filter((reference) =>
    reference.targetChange.remote.state === 'absent'
    && reference.targetChange.local.state === 'present')
    .sort((left, right) => compareReferenceEvidenceByPriority(new Map([
      ['menu-item-parent', 0],
      ['post-parent', 1],
    ]), left, right));
  const navigationReference = samePlanNavigationReferences[0];
  const samePlanNavigationReason = samePlanNavigationReferences.some((reference) => reference.relationshipType === 'menu-item-parent')
    ? `WordPress graph mutation ${resource.key} is created in the same plan as a menu item parent target that depends on it, and identity rewriting is not yet supported.`
    : samePlanNavigationReferences.some((reference) => reference.relationshipType === 'post-parent')
      ? `WordPress graph mutation ${resource.key} is created in the same plan as a post parent target that depends on it, and identity rewriting is not yet supported.`
      : 'Navigation and menu graph resources are not yet supported by the planner.';
  return {
    supported: false,
    className: 'unsupported-navigation-resource',
    unsupportedState: localValue === ABSENT
      ? 'delete'
      : navigationReference
        ? 'same-plan-reference'
        : classifyUnsupportedDriftState({
          baseValue,
          localValue,
          remoteValue,
          allowSteadyUnsupported: true,
        }),
    reason: navigationReference
      ? samePlanNavigationReason
      : localValue === ABSENT
        ? 'Navigation and menu graph resource deletes are not yet supported by the planner.'
        : 'Navigation and menu graph resources are not yet supported by the planner.',
    references: navigationReference ? samePlanNavigationReferences : [],
  };
}

function unsupportedAttachmentResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT || candidate.post_type !== 'attachment') {
    return { supported: true };
  }

  const samePlanCreatedAttachment = localValue !== ABSENT && baseValue === ABSENT && remoteValue === ABSENT;
  if (samePlanCreatedAttachment) {
    const inboundReferences = resources
      .filter((sourceResource) => sourceResource.type === 'row')
      .flatMap((sourceResource) => {
        const sourceLocalValue = getResource(local, sourceResource);
        if (sourceLocalValue === ABSENT) {
          return [];
        }
        return wordpressGraphReferences(sourceResource, sourceLocalValue)
          .filter((reference) => reference.targetResourceKey === resource.key)
          .map((reference) =>
            wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
      })
      .filter((reference) =>
        reference.targetChange.remote.state === 'absent'
        && reference.targetChange.local.state === 'present'
        && (
          reference.relationshipType === 'postmeta-post'
          || reference.relationshipType === 'featured-image-attachment'
          || reference.relationshipType === 'post-parent'
          || reference.relationshipType === 'term-relationship-object'
        ))
      .sort((left, right) => compareReferenceEvidenceByPriority(new Map([
        ['postmeta-post', 0],
        ['featured-image-attachment', 1],
        ['post-parent', 2],
        ['term-relationship-object', 3],
      ]), left, right));
    const samePlanAttachmentReason = inboundReferences.some((reference) =>
      reference.relationshipType === 'postmeta-post')
      ? `WordPress graph mutation ${resource.key} is created in the same plan as a post meta attachment target that depends on it, and identity rewriting is not yet supported.`
      : inboundReferences.some((reference) => reference.relationshipType === 'featured-image-attachment')
        ? `WordPress graph mutation ${resource.key} is created in the same plan as a featured image attachment target that depends on it, and identity rewriting is not yet supported.`
        : inboundReferences.some((reference) => reference.relationshipType === 'post-parent')
          ? `WordPress graph mutation ${resource.key} is created in the same plan as a post parent attachment target that depends on it, and identity rewriting is not yet supported.`
          : inboundReferences.some((reference) => reference.relationshipType === 'term-relationship-object')
            ? `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship attachment target that depends on it, and identity rewriting is not yet supported.`
            : 'Attachment graph resources are not yet supported by the planner.';
    const references = inboundReferences.length > 0
      ? inboundReferences
      : wordpressGraphReferences(resource, candidate).map((reference) =>
        wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
    return {
      supported: false,
      className: 'unsupported-attachment-resource',
      unsupportedState: 'same-plan-reference',
      reason: samePlanAttachmentReason,
      references,
    };
  }

  const references = wordpressGraphReferences(resource, candidate);
  const referenceEvidence = references.map((reference) =>
    wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
  return {
    supported: false,
    className: 'unsupported-attachment-resource',
    unsupportedState: classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: true,
    }),
    reason: localValue === ABSENT
      ? 'Attachment graph resource deletes are not yet supported by the planner.'
      : 'Attachment graph resources are not yet supported by the planner.',
    references: referenceEvidence,
  };
}

function unsupportedRevisionResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT || candidate.post_type !== 'revision') {
    return { supported: true };
  }

  const samePlanCreatedRevision = localValue !== ABSENT && baseValue === ABSENT && remoteValue === ABSENT;
  const referenceEvidence = wordpressGraphReferences(resource, candidate).map((reference) =>
    wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
  const references = samePlanCreatedRevision
    ? resources
      .filter((sourceResource) => sourceResource.type === 'row')
      .flatMap((sourceResource) => {
        const sourceLocalValue = getResource(local, sourceResource);
        if (sourceLocalValue === ABSENT) {
          return [];
        }
        return wordpressGraphReferences(sourceResource, sourceLocalValue)
          .filter((reference) => reference.targetResourceKey === resource.key)
          .map((reference) =>
            wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
      })
      .filter((reference) =>
        reference.relationshipType === 'post-parent'
        || reference.relationshipType === 'postmeta-post'
        || reference.relationshipType === 'term-relationship-object')
      .sort((left, right) => compareReferenceEvidenceByPriority(new Map([
        ['post-parent', 0],
        ['postmeta-post', 1],
        ['term-relationship-object', 2],
      ]), left, right))
    : [];
  const samePlanRevisionReason = references.some((reference) => reference.relationshipType === 'post-parent')
    ? `WordPress graph mutation ${resource.key} is created in the same plan as a post parent revision target that depends on it, and identity rewriting is not yet supported.`
    : references.some((reference) => reference.relationshipType === 'postmeta-post')
      ? `WordPress graph mutation ${resource.key} is created in the same plan as a postmeta revision target that depends on it, and identity rewriting is not yet supported.`
      : references.some((reference) => reference.relationshipType === 'term-relationship-object')
        ? `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship revision target that depends on it, and identity rewriting is not yet supported.`
        : `WordPress graph mutation ${resource.key} is created in the same plan as a revision identity that depends on it, and identity rewriting is not yet supported.`;
  return {
    supported: false,
    className: 'unsupported-revision-resource',
    unsupportedState: localValue === ABSENT
      ? 'delete'
      : samePlanCreatedRevision
        ? 'same-plan-reference'
        : classifyUnsupportedDriftState({
          baseValue,
          localValue,
          remoteValue,
          allowSteadyUnsupported: true,
    }),
    reason: samePlanCreatedRevision
      ? samePlanRevisionReason
        : localValue === ABSENT
          ? 'Revision graph resource deletes are not yet supported by the planner.'
          : 'Revision graph resources are not yet supported by the planner.',
    references: references.length > 0 ? references : referenceEvidence,
  };
}

function unsupportedTermmetaResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_termmeta') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }
  if (localValue === ABSENT) {
    return {
      supported: false,
      className: 'unsupported-termmeta-resource',
      unsupportedState: 'delete',
      reason: 'Term meta graph resource deletes are not yet supported by the planner.',
    };
  }

  const references = wordpressGraphReferences(resource, candidate);
  const referenceEvidence = references.map((reference) =>
    wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
  const termReference = referenceEvidence.find((reference) =>
    reference.relationshipType === 'termmeta-term'
    && reference.targetChange.remote.state === 'absent'
    && reference.targetChange.local.state === 'present');
  if (termReference) {
    const targetTermId = normalizePositiveInteger(termReference.targetId);
    const localNavMenuTaxonomy = [...(local?.db?.wp_term_taxonomy ? Object.values(local.db.wp_term_taxonomy) : [])]
      .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');
    const remoteNavMenuTaxonomy = [...(remote?.db?.wp_term_taxonomy ? Object.values(remote.db.wp_term_taxonomy) : [])]
      .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');
    if (localNavMenuTaxonomy || remoteNavMenuTaxonomy) {
      return {
        supported: false,
        className: 'unsupported-navigation-resource',
        unsupportedState: 'same-plan-reference',
        reason: 'Navigation and menu graph resources are not yet supported by the planner.',
        references: [termReference],
      };
    }

    if (
      !isSupportedSamePlanTermmetaReference({
        baseValue,
        reference: termReference,
        local,
        remote,
      })
    ) {
      return {
        supported: false,
        className: 'unsupported-termmeta-resource',
        unsupportedState: 'same-plan-reference',
        reason: `WordPress graph mutation ${resource.key} is created in the same plan as a term identity that depends on it, and identity rewriting is not yet supported.`,
        references: [termReference],
      };
    }

    return { supported: true };
  }
  const unsupportedState = termReference
    ? 'same-plan-reference'
    : classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: true,
    });

  return {
    supported: false,
    className: 'unsupported-termmeta-resource',
    unsupportedState,
    reason: 'Term meta graph resources are not yet supported by the planner.',
    references: referenceEvidence,
  };
}

function unsupportedTermTaxonomyResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_term_taxonomy') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }
  if (localValue === ABSENT) {
    return {
      supported: false,
      className: 'unsupported-term-taxonomy-resource',
      unsupportedState: 'delete',
      reason: 'Term taxonomy graph resource deletes are not yet supported by the planner.',
    };
  }

  const references = wordpressGraphReferences(resource, candidate);
  const referenceEvidence = references.map((reference) =>
    wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
  const samePlanCreatedTaxonomyRelationshipReferences = (
    localValue !== ABSENT
    && baseValue === ABSENT
    && remoteValue === ABSENT
  )
    ? resources
      .filter((sourceResource) => sourceResource.type === 'row')
      .flatMap((sourceResource) => {
        const sourceLocalValue = getResource(local, sourceResource);
        if (sourceLocalValue === ABSENT) {
          return [];
        }
        return wordpressGraphReferences(sourceResource, sourceLocalValue)
          .filter((reference) => reference.targetResourceKey === resource.key)
          .map((reference) =>
            wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
      })
      .filter((reference) =>
        reference.relationshipType === 'term-relationship-taxonomy'
        && reference.targetChange.remote.state === 'absent'
        && reference.targetChange.local.state === 'present')
      .sort((left, right) => compareReferenceEvidenceByPriority(new Map([
        ['term-relationship-taxonomy', 0],
      ]), left, right))
    : [];
  const samePlanCreatedTermReferences = referenceEvidence.filter((reference) => (
    (reference.relationshipType === 'term-taxonomy-term' || reference.relationshipType === 'term-taxonomy-parent')
    && reference.targetChange.remote.state === 'absent'
    && reference.targetChange.local.state === 'present'
  )).sort((left, right) => compareReferenceEvidenceByPriority(new Map([
    ['term-taxonomy-parent', 0],
    ['term-taxonomy-term', 1],
  ]), left, right));
  const samePlanReferences = [
    ...samePlanCreatedTermReferences,
    ...samePlanCreatedTaxonomyRelationshipReferences,
  ];
  const navMenuSamePlanTermReference = samePlanCreatedTermReferences.find((reference) => {
    if (reference.relationshipType !== 'term-taxonomy-term') {
      return false;
    }
    const targetTermId = normalizeWordPressGraphReferenceTargetIntegerId(reference);
    if (targetTermId == null) {
      return false;
    }
    const localNavMenuTaxonomy = [...(local?.db?.wp_term_taxonomy ? Object.values(local.db.wp_term_taxonomy) : [])]
      .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');
    const remoteNavMenuTaxonomy = [...(remote?.db?.wp_term_taxonomy ? Object.values(remote.db.wp_term_taxonomy) : [])]
      .find((entry) => normalizePositiveInteger(entry?.term_id) === targetTermId && entry?.taxonomy === 'nav_menu');
    return Boolean(localNavMenuTaxonomy || remoteNavMenuTaxonomy || candidate?.taxonomy === 'nav_menu' || baseValue?.taxonomy === 'nav_menu');
  });
  if (navMenuSamePlanTermReference) {
    return {
      supported: false,
      className: 'unsupported-navigation-resource',
      unsupportedState: 'same-plan-reference',
      reason: 'Navigation and menu graph resources are not yet supported by the planner.',
      references: [navMenuSamePlanTermReference],
    };
  }
  const supportedSamePlanTermReferences = samePlanCreatedTermReferences.filter((reference) =>
    isSupportedSamePlanTermTaxonomyReference({
      baseValue,
      localValue,
      reference,
      local,
      remote,
    })
    || isSupportedSamePlanTermTaxonomyParentReference({
      baseValue,
      localValue,
      reference,
      local,
      remote,
    }));
  const supportedSamePlanTaxonomyRelationshipReferences = samePlanCreatedTaxonomyRelationshipReferences.filter((reference) =>
    {
      const sourceResource = resources.find((candidate) => candidate.key === reference.sourceResourceKey);
      if (!sourceResource) {
        return false;
      }
      return isSupportedSamePlanTermRelationshipTaxonomyReference({
        baseValue: getResource(base, sourceResource),
        localValue: getResource(local, sourceResource),
        reference,
      });
    });
  if (
    samePlanReferences.length > 0
    && supportedSamePlanTermReferences.length === samePlanCreatedTermReferences.length
    && supportedSamePlanTaxonomyRelationshipReferences.length === samePlanCreatedTaxonomyRelationshipReferences.length
  ) {
    return { supported: true };
  }
  const unsupportedState = (
    samePlanReferences.length > 0
  )
    ? 'same-plan-reference'
    : classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: true,
    });

  return {
    supported: false,
    className: 'unsupported-term-taxonomy-resource',
    unsupportedState,
    reason: samePlanCreatedTermReferences.some((reference) => reference.relationshipType === 'term-taxonomy-parent')
      ? `WordPress graph mutation ${resource.key} is created in the same plan as a parent term identity that depends on it, and identity rewriting is not yet supported.`
      : samePlanCreatedTermReferences.some((reference) => reference.relationshipType === 'term-taxonomy-term')
        ? `WordPress graph mutation ${resource.key} is created in the same plan as a term identity that depends on it, and identity rewriting is not yet supported.`
        : samePlanCreatedTaxonomyRelationshipReferences.length > 0
          ? `WordPress graph mutation ${resource.key} is created in the same plan as a term relationship taxonomy target that depends on it, and identity rewriting is not yet supported.`
          : 'Term taxonomy graph resources are not yet supported by the planner.',
    references: samePlanReferences,
  };
}

function unsupportedGuidResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  const candidateGuid = candidate && typeof candidate === 'object' ? candidate.guid : undefined;
  const baseGuid = baseValue !== ABSENT && baseValue && typeof baseValue === 'object' ? baseValue.guid : undefined;
  const localGuid = localValue !== ABSENT && localValue && typeof localValue === 'object' ? localValue.guid : undefined;
  const remoteGuid = remoteValue !== ABSENT && remoteValue && typeof remoteValue === 'object' ? remoteValue.guid : undefined;
  const localIntroducedGuid = (
    localValue !== ABSENT
    && localGuid != null
    && localGuid !== ''
    && (baseValue === ABSENT || baseGuid == null || baseGuid === '' || localGuid !== baseGuid)
  );
  const remoteIntroducedGuid = (
    remoteValue !== ABSENT
    && remoteGuid != null
    && remoteGuid !== ''
    && (baseValue === ABSENT || baseGuid == null || baseGuid === '' || remoteGuid !== baseGuid)
  );
  const remoteOnlyDrift = (
    stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) !== stableStringify(baseValue)
  );
  const convergedDrift = (
    localValue !== ABSENT
    && remoteValue !== ABSENT
    && stableStringify(localValue) === stableStringify(remoteValue)
    && stableStringify(localValue) !== stableStringify(baseValue)
  );
  const steadyUnsupported = (
    localValue !== ABSENT
    && remoteValue !== ABSENT
    && stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) === stableStringify(baseValue)
  );
  if (
    !candidate
    || candidate === ABSENT
    || candidateGuid == null
    || candidateGuid === ''
    || (
      !localIntroducedGuid
      && !remoteIntroducedGuid
      && !steadyUnsupported
    )
  ) {
    return { supported: true };
  }

  return {
    supported: false,
    className: 'unsupported-guid-resource',
    unsupportedState: convergedDrift
      ? 'converged-drift'
      : remoteOnlyDrift
        ? 'remote-only-drift'
        : steadyUnsupported
          ? 'steady-unsupported'
        : 'local-or-divergent-drift',
    reason: 'Post GUID graph resources are not yet supported by the planner.',
  };
}

function unsupportedCommentsUsersResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || !['wp_comments', 'wp_users'].includes(resource.table)) {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }
  const remoteOnlyDrift = (
    stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) !== stableStringify(baseValue)
  );
  const convergedDrift = (
    localValue !== ABSENT
    && remoteValue !== ABSENT
    && stableStringify(localValue) === stableStringify(remoteValue)
    && stableStringify(localValue) !== stableStringify(baseValue)
  );

  if (localValue === ABSENT) {
    return {
      supported: false,
      className: 'unsupported-comments-users-resource',
      unsupportedState: 'delete',
      reason: resource.table === 'wp_users'
        ? 'User graph resource deletes are not yet supported by the planner.'
        : 'Comments graph resource deletes are not yet supported by the planner.',
    };
  }

  if (resource.table === 'wp_comments') {
    const references = wordpressGraphReferences(resource, candidate);
    const commentGraphReferences = references
      .map((reference) => wordpressGraphReferenceEvidence(reference, resources, base, local, remote))
      .filter((reference) =>
        (
          reference.relationshipType === 'comment-parent'
          && reference.targetResource?.table === 'wp_comments'
          && reference.targetChange.remote.state === 'absent'
          && reference.targetChange.local.state === 'present'
        )
        || (
          reference.relationshipType === 'comment-post'
          && reference.targetResource?.table === 'wp_posts'
          && reference.targetChange.remote.state === 'absent'
          && reference.targetChange.local.state === 'present'
        )
        || (
          reference.relationshipType === 'comment-user'
          && reference.targetResource?.table === 'wp_users'
          && reference.targetChange.remote.state === 'absent'
          && reference.targetChange.local.state === 'present'
        ))
      .sort((left, right) => compareReferenceEvidenceByPriority(new Map([
        ['comment-parent', 0],
        ['comment-post', 1],
        ['comment-user', 2],
      ]), left, right));

    if (commentGraphReferences.length > 0) {
      return {
        supported: false,
        className: 'unsupported-comments-users-resource',
        unsupportedState: 'same-plan-reference',
        reason: commentGraphReferences.some((reference) => reference.relationshipType === 'comment-parent')
          ? `WordPress graph mutation ${resource.key} is created in the same plan as a parent comment identity that depends on it, and identity rewriting is not yet supported.`
          : commentGraphReferences.some((reference) => reference.relationshipType === 'comment-post')
            ? `WordPress graph mutation ${resource.key} is created in the same plan as a comment post identity that depends on it, and identity rewriting is not yet supported.`
            : `WordPress graph mutation ${resource.key} is created in the same plan as a comment user identity that depends on it, and identity rewriting is not yet supported.`,
        references: commentGraphReferences,
      };
    }

    const inboundCommentReferences = resources
      .filter((sourceResource) => sourceResource.type === 'row')
      .flatMap((sourceResource) => {
        const sourceLocalValue = getResource(local, sourceResource);
        if (sourceLocalValue === ABSENT) {
          return [];
        }
        return wordpressGraphReferences(sourceResource, sourceLocalValue)
          .filter((reference) => reference.targetResourceKey === resource.key)
          .map((reference) =>
            wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
      })
      .filter((reference) =>
        (
          reference.relationshipType === 'comment-parent'
          || reference.relationshipType === 'commentmeta-comment'
        )
        && reference.targetChange.remote.state === 'absent'
        && reference.targetChange.local.state === 'present');

    if (inboundCommentReferences.length > 0) {
      const orderedInboundCommentReferences = inboundCommentReferences.slice().sort((left, right) =>
        compareReferenceEvidenceByPriority(new Map([
          ['comment-parent', 0],
          ['commentmeta-comment', 1],
        ]), left, right));
      const commentReference = orderedInboundCommentReferences[0];
      return {
        supported: false,
        className: 'unsupported-comments-users-resource',
        unsupportedState: 'same-plan-reference',
        reason: commentReference.relationshipType === 'comment-parent'
          ? `WordPress graph mutation ${resource.key} is created in the same plan as a parent comment identity that depends on it, and identity rewriting is not yet supported.`
          : `WordPress graph mutation ${resource.key} is created in the same plan as a comment meta identity that depends on it, and identity rewriting is not yet supported.`,
        references: orderedInboundCommentReferences,
      };
    }
  }

  if (resource.table === 'wp_users') {
    const inboundUserReferences = resources
      .filter((sourceResource) => sourceResource.type === 'row')
      .flatMap((sourceResource) => {
        const sourceLocalValue = getResource(local, sourceResource);
        if (sourceLocalValue === ABSENT) {
          return [];
        }
        return wordpressGraphReferences(sourceResource, sourceLocalValue)
          .filter((reference) => reference.targetResourceKey === resource.key)
          .map((reference) =>
            wordpressGraphReferenceEvidence(reference, resources, base, local, remote));
      })
      .filter((reference) =>
        (
          reference.relationshipType === 'comment-user'
          || reference.relationshipType === 'usermeta-user'
          || reference.relationshipType === 'post-author'
        )
        && reference.targetChange.remote.state === 'absent'
        && reference.targetChange.local.state === 'present');

    if (inboundUserReferences.length > 0) {
      const orderedInboundUserReferences = inboundUserReferences.slice().sort((left, right) =>
        compareReferenceEvidenceByPriority(new Map([
          ['comment-user', 0],
          ['usermeta-user', 1],
          ['post-author', 2],
        ]), left, right));
      const userReference = orderedInboundUserReferences[0];
      return {
        supported: false,
        className: 'unsupported-comments-users-resource',
        unsupportedState: 'same-plan-reference',
        reason: userReference.relationshipType === 'comment-user'
          ? `WordPress graph mutation ${resource.key} is created in the same plan as a comment user identity that depends on it, and identity rewriting is not yet supported.`
          : userReference.relationshipType === 'usermeta-user'
            ? `WordPress graph mutation ${resource.key} is created in the same plan as a user meta identity that depends on it, and identity rewriting is not yet supported.`
            : `WordPress graph mutation ${resource.key} is created in the same plan as a post author identity that depends on it, and identity rewriting is not yet supported.`,
        references: orderedInboundUserReferences,
      };
    }
  }

  return {
    supported: false,
    className: 'unsupported-comments-users-resource',
    unsupportedState: classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: true,
    }),
    reason: resource.table === 'wp_users'
      ? 'User graph resources are not yet supported by the planner.'
      : 'Comments graph resources are not yet supported by the planner.',
  };
}

function unsupportedCommentmetaResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_commentmeta') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }
  if (localValue === ABSENT) {
    return {
      supported: false,
      className: 'unsupported-commentmeta-resource',
      unsupportedState: 'delete',
      reason: 'Comment meta graph resource deletes are not yet supported by the planner.',
    };
  }

  const references = wordpressGraphReferences(resource, candidate);
  const commentGraphReference = references
    .map((reference) => wordpressGraphReferenceEvidence(reference, resources, base, local, remote))
    .find((reference) =>
      reference.relationshipType === 'commentmeta-comment'
      && reference.targetResource?.table === 'wp_comments'
      && reference.targetChange.remote.state === 'absent'
      && reference.targetChange.local.state === 'present');

  if (commentGraphReference) {
    return {
      supported: false,
      className: 'unsupported-commentmeta-resource',
      unsupportedState: 'same-plan-reference',
      reason: `WordPress graph mutation ${resource.key} is created in the same plan as a comment identity that depends on it, and identity rewriting is not yet supported.`,
      references: [commentGraphReference],
    };
  }

  return {
    supported: false,
    className: 'unsupported-commentmeta-resource',
    unsupportedState: classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: true,
    }),
    reason: 'Comment meta graph resources are not yet supported by the planner.',
  };
}

function unsupportedUsermetaResourceSupport({ resource, baseValue, localValue, remoteValue, resources, base, local, remote }) {
  if (resource.type !== 'row' || resource.table !== 'wp_usermeta') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT) {
    return { supported: true };
  }
  if (localValue === ABSENT) {
    return {
      supported: false,
      className: 'unsupported-usermeta-resource',
      unsupportedState: 'delete',
      reason: 'User meta graph resource deletes are not yet supported by the planner.',
    };
  }

  const references = wordpressGraphReferences(resource, candidate);
  const userGraphReference = references
    .map((reference) => wordpressGraphReferenceEvidence(reference, resources, base, local, remote))
    .find((reference) =>
      reference.relationshipType === 'usermeta-user'
      && reference.targetResource?.table === 'wp_users'
      && reference.targetChange.remote.state === 'absent'
      && reference.targetChange.local.state === 'present');

  if (userGraphReference) {
    return {
      supported: false,
      className: 'unsupported-usermeta-resource',
      unsupportedState: 'same-plan-reference',
      reason: `WordPress graph mutation ${resource.key} is created in the same plan as a user identity that depends on it, and identity rewriting is not yet supported.`,
      references: [userGraphReference],
    };
  }

  return {
    supported: false,
    className: 'unsupported-usermeta-resource',
    unsupportedState: classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: true,
    }),
    reason: 'User meta graph resources are not yet supported by the planner.',
  };
}

function unsupportedLegacyLinksResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_links') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  const remoteOnlyDrift = (
    stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) !== stableStringify(baseValue)
  );
  const convergedDrift = (
    localValue !== ABSENT
    && remoteValue !== ABSENT
    && stableStringify(localValue) === stableStringify(remoteValue)
    && stableStringify(localValue) !== stableStringify(baseValue)
  );
  if (candidate && candidate !== ABSENT) {
    if (localValue === ABSENT) {
      return {
        supported: false,
        className: 'unsupported-legacy-links-resource',
        unsupportedState: 'delete',
        reason: 'Legacy link graph resource deletes are not yet supported by the planner.',
      };
    }
    return {
      supported: false,
      className: 'unsupported-legacy-links-resource',
      unsupportedState: classifyUnsupportedDriftState({
        baseValue,
        localValue,
        remoteValue,
        allowSteadyUnsupported: true,
      }),
      reason: 'Legacy link graph resources are not yet supported by the planner.',
    };
  }

  return { supported: true };
}

function unsupportedSerializedBlocksSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'row' || resource.table !== 'wp_posts') {
    return { supported: true };
  }

  const candidate = localValue !== ABSENT ? localValue : (baseValue !== ABSENT ? baseValue : remoteValue);
  if (!candidate || candidate === ABSENT || typeof candidate.post_content !== 'string') {
    return { supported: true };
  }

  if (!candidate.post_content.includes('<!-- wp:')) {
    return { supported: true };
  }

  const remoteOnlyDrift = (
    stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) !== stableStringify(baseValue)
  );
  const convergedDrift = (
    localValue !== ABSENT
    && remoteValue !== ABSENT
    && stableStringify(localValue) === stableStringify(remoteValue)
    && stableStringify(localValue) !== stableStringify(baseValue)
  );

  return {
    supported: false,
    className: 'unsupported-serialized-blocks-resource',
    unsupportedState: classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: true,
    }),
    reason: 'Serialized block references are not yet supported by the planner.',
  };
}

function unsupportedSpecialFileResourceSupport({ resource, baseValue, localValue, remoteValue }) {
  if (resource.type !== 'file') {
    return { supported: true };
  }

  const localChanged = localValue !== ABSENT && localValue !== baseValue;
  const remoteChanged = remoteValue !== ABSENT && remoteValue !== baseValue;
  const changedValues = [
    localChanged ? localValue : null,
    remoteChanged ? remoteValue : null,
    baseValue !== ABSENT ? baseValue : null,
  ].filter(Boolean);

  if (changedValues.length === 0) {
    return { supported: true };
  }

  const unsupportedValue = changedValues.find((value) => isUnsupportedSpecialFileValue(value));
  if (!unsupportedValue) {
    return { supported: true };
  }

  const remoteOnlyDrift = (
    stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) !== stableStringify(baseValue)
  );
  const convergedDrift = (
    localValue !== ABSENT
    && remoteValue !== ABSENT
    && stableStringify(localValue) === stableStringify(remoteValue)
    && stableStringify(localValue) !== stableStringify(baseValue)
  );
  const steadyUnsupported = (
    stableStringify(localValue) === stableStringify(baseValue)
    && stableStringify(remoteValue) === stableStringify(baseValue)
  );

  return {
    supported: false,
    className: 'unsupported-special-file-resource',
    unsupportedState: classifyUnsupportedDriftState({
      baseValue,
      localValue,
      remoteValue,
      allowSteadyUnsupported: true,
    }),
    reason: 'Special file entries are not yet supported by the planner.',
  };
}

function isUnsupportedSpecialFileValue(value) {
  const specialTypes = new Set([
    'symlink',
    'junction',
    'reparse',
    'reparse-point',
    'submodule',
    'gitlink',
    'fifo',
    'socket',
    'device',
    'block',
    'block-device',
    'character',
    'char',
    'char-device',
    'named-pipe',
    'pipe',
    'hardlink',
    'hard-link',
  ]);
  const specialModeMasks = new Set([
    0o120000, // symlink
    0o060000, // block device
    0o020000, // character device
    0o010000, // named pipe / fifo
    0o140000, // socket
    0o100000, // regular file, kept only for explicit negative checks
  ]);

  if (typeof value?.type === 'string' && specialTypes.has(value.type)) {
    return true;
  }

  if (typeof value?.mode === 'number') {
    const fileType = value.mode & 0o170000;
    if (specialModeMasks.has(fileType) && fileType !== 0o100000) {
      return true;
    }
  }

  return Boolean(value?.target) || Boolean(value?.linkTarget) || Boolean(value?.inode);
}

function addFileTopologyConflicts(plan, resources, base, local, remote) {
  const fileResources = resources.filter((resource) => resource.type === 'file');
  const mutationByKey = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const unsafeMutationKeys = new Set();
  const added = new Set();

  for (const mutation of plan.mutations) {
    if (mutation.resource.type !== 'file') {
      continue;
    }

    const mutationAfter = deserializeResourceValue(mutation.value);
    const mutationAfterType = fileValueType(mutationAfter);

    for (const other of fileResources) {
      if (other.key === mutation.resourceKey) {
        continue;
      }

      const remoteValue = getResource(remote, other);
      if (remoteValue === ABSENT) {
        continue;
      }

      if (isAncestorPath(mutation.resource.path, other.path)) {
        if (
          (mutationAfter === ABSENT || mutationAfterType !== 'directory')
          && shouldStopForDescendant(mutationByKey, other, base, remote)
        ) {
          unsafeMutationKeys.add(mutation.resourceKey);
          addTopologyConflict(
            plan,
            added,
            'descendant-hidden',
            mutation.resource,
            other,
            base,
            local,
            remote,
            'Local file deletion or type change would hide or remove a live remote descendant.',
          );
        }
        continue;
      }

      if (isAncestorPath(other.path, mutation.resource.path)) {
        const ancestorMutation = mutationByKey.get(other.key);
        const ancestorAfter = ancestorMutation
          ? deserializeResourceValue(ancestorMutation.value)
          : remoteValue;
        if (
          ancestorAfter !== ABSENT
          && fileValueType(ancestorAfter) !== 'directory'
          && shouldStopForAncestor(ancestorMutation, other, base, remote)
        ) {
          unsafeMutationKeys.add(mutation.resourceKey);
          addTopologyConflict(
            plan,
            added,
            'ancestor-blocks-descendant',
            mutation.resource,
            other,
            base,
            local,
            remote,
            'Local descendant change would require overwriting a live remote ancestor.',
          );
        }
      }
    }
  }

  removeUnsafeMutations(plan, unsafeMutationKeys);
}

function shouldStopForDescendant(mutationByKey, descendant, base, remote) {
  const descendantMutation = mutationByKey.get(descendant.key);
  if (
    descendantMutation?.action === 'delete'
    && resourceHash(remote, descendant) === resourceHash(base, descendant)
  ) {
    return false;
  }
  return true;
}

function shouldStopForAncestor(ancestorMutation, ancestor, base, remote) {
  if (ancestorMutation && resourceHash(remote, ancestor) === resourceHash(base, ancestor)) {
    return false;
  }
  return true;
}

function addTopologyConflict(plan, added, mode, resource, relatedResource, base, local, remote, reason) {
  const key = `${mode}:${resource.key}:${relatedResource.key}`;
  if (added.has(key)) {
    return;
  }
  added.add(key);

  const baseValue = getResource(base, resource);
  const localValue = getResource(local, resource);
  const remoteValue = getResource(remote, resource);
  const relatedBaseValue = getResource(base, relatedResource);
  const relatedLocalValue = getResource(local, relatedResource);
  const relatedRemoteValue = getResource(remote, relatedResource);
  const owner = pluginOwnerFor(resource, baseValue, localValue, remoteValue);

  addConflict(plan, {
    resource,
    reason,
    resolutionPolicy: 'preserve-remote-file-topology-and-stop',
    baseValue,
    localValue,
    remoteValue,
    baseHash: resourceHash(base, resource),
    localHash: resourceHash(local, resource),
    remoteHash: resourceHash(remote, resource),
    owner,
    className: 'file-topology-conflict',
    relatedResource,
    relatedChange: changeEvidence(
      relatedResource,
      relatedBaseValue,
      relatedLocalValue,
      relatedRemoteValue,
      resourceHash(base, relatedResource),
      resourceHash(local, relatedResource),
      resourceHash(remote, relatedResource),
    ),
  });
}

function removeUnsafeMutations(plan, unsafeMutationKeys) {
  if (unsafeMutationKeys.size === 0) {
    return;
  }

  const removedMutationIds = new Set();
  plan.mutations = plan.mutations.filter((mutation) => {
    if (!unsafeMutationKeys.has(mutation.resourceKey)) {
      return true;
    }
    removedMutationIds.add(mutation.id);
    return false;
  });
  plan.preconditions = plan.preconditions.filter((precondition) =>
    !removedMutationIds.has(precondition.mutationId));
}

function enforceMutationPreconditionInvariant(plan) {
  const preconditionsByMutation = new Map();
  for (const precondition of plan.preconditions) {
    preconditionsByMutation.set(precondition.mutationId, precondition);
  }

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutation.get(mutation.id);
    if (
      !precondition
      || precondition.resourceKey !== mutation.resourceKey
      || precondition.expectedHash !== mutation.remoteBeforeHash
      || precondition.checkedAgainst !== 'live-remote'
    ) {
      plan.blockers.push({
        id: `blocker-${mutation.id}-missing-live-remote-precondition`,
        class: 'planner-invariant-violation',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
        reason: 'Mutation is missing a matching live remote precondition.',
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteHash: mutation.remoteBeforeHash,
      });
    }
  }
}

function changeEvidence(resource, baseValue, localValue, remoteValue, baseHash, localHash, remoteHash) {
  return {
    localChange: changeKind(resource, baseValue, localValue, baseHash, localHash),
    remoteChange: changeKind(resource, baseValue, remoteValue, baseHash, remoteHash),
    base: valueEvidence(resource, baseValue, baseHash),
    local: valueEvidence(resource, localValue, localHash),
    remote: valueEvidence(resource, remoteValue, remoteHash),
  };
}

function changeKind(resource, beforeValue, afterValue, beforeHash, afterHash) {
  if (beforeHash === afterHash) {
    return 'unchanged';
  }
  if (beforeValue === ABSENT && afterValue !== ABSENT) {
    return 'create';
  }
  if (beforeValue !== ABSENT && afterValue === ABSENT) {
    return 'delete';
  }
  if (resource.type === 'file' && fileValueType(beforeValue) !== fileValueType(afterValue)) {
    return 'type-change';
  }
  return 'update';
}

function valueEvidence(resource, value, hash) {
  if (value === ABSENT) {
    return {
      state: 'absent',
      hash,
    };
  }

  const evidence = {
    state: 'present',
    hash,
  };

  if (resource.type === 'file') {
    evidence.fileType = fileValueType(value);
  }

  return evidence;
}

function fileValueType(value) {
  if (value === ABSENT) {
    return 'absent';
  }
  if (value && typeof value === 'object' && typeof value.type === 'string') {
    return value.type;
  }
  return 'file';
}

function isAncestorPath(ancestor, descendant) {
  const ancestorParts = pathParts(ancestor);
  const descendantParts = pathParts(descendant);
  if (ancestorParts.length >= descendantParts.length) {
    return false;
  }
  return ancestorParts.every((part, index) => part === descendantParts[index]);
}

function pathParts(path) {
  return path.split('/').filter(Boolean);
}
