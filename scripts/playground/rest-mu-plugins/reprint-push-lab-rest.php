<?php
/**
 * Local Playground mu-plugin loader for the Reprint Push Lab REST endpoint.
 *
 * Mount this directory to /wordpress/wp-content/mu-plugins and the repository
 * root to /workspace when running a disposable local Playground server.
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once '/workspace/scripts/playground/push-remote-rest-plugin.php';
