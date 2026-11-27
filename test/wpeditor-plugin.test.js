// Complemento 1.6.0 · editor de WordPress en Ecos: la dirección de un solo uso. Se ejecuta el PHP real (includes/editor.php)
// con unas funciones mínimas de WordPress simuladas; sin php instalado, solo se comprueba el texto.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'wp-plugin', 'ecos');
const SRC = fs.readFileSync(path.join(DIR, 'includes', 'editor.php'), 'utf8');
const hasPhp = (() => { try { execFileSync('php', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('editor.php (texto): ruta REST, token de 32 bytes con hash, transient de 60 s, un solo uso y cookie', () => {
  assert.match(SRC, /'\/editor-session'/); assert.match(SRC, /'methods'\s*=>\s*'POST'/); assert.match(SRC, /ecos_wp_can_edit/);
  assert.match(SRC, /random_bytes\( 32 \)/); assert.match(SRC, /hash\( 'sha256'/);
  assert.match(SRC, /ECOS_WP_EDITOR_TTL', 60/); assert.match(SRC, /set_transient/); assert.match(SRC, /delete_transient/);
  assert.match(SRC, /admin_post_nopriv_ecos_editor/); assert.match(SRC, /wp_set_auth_cookie/); assert.match(SRC, /wp_safe_redirect/);
  assert.match(SRC, /Referrer-Policy: no-referrer/);
  // el token nunca se guarda en claro: la clave del transient lleva el hash
  assert.doesNotMatch(SRC, /set_transient\(\s*'ecos_ed_'\s*\.\s*\$token/);
  const main = fs.readFileSync(path.join(DIR, 'ecos.php'), 'utf8');
  assert.match(main, /includes\/editor\.php/); assert.match(main, /'editor'\s*=>\s*true/);
});

// Entorno simulado de WordPress + guion de la prueba
function run(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-ed-'));
  const file = path.join(dir, 't.php');
  fs.writeFileSync(file, `<?php
define('ABSPATH','/x/'); $GLOBALS['T']=array(); $GLOBALS['log']=array();
class WP_Error { public $c; public $m; function __construct($c,$m,$d=array()){ $this->c=$c; $this->m=$m; } }
class WP_REST_Request { private $p; function __construct($p){ $this->p=$p; } function get_param($k){ return $this->p[$k] ?? null; } }
function admin_url($p=''){ return 'https://web.example/wp-admin/'.$p; }
function set_transient($k,$v,$t){ $GLOBALS['T'][$k]=array($v,$t); return true; }
function get_transient($k){ return isset($GLOBALS['T'][$k]) ? $GLOBALS['T'][$k][0] : false; }
function delete_transient($k){ unset($GLOBALS['T'][$k]); return true; }
function rest_ensure_response($d){ return $d; }
function get_current_user_id(){ return 7; }
function current_user_can($c,$id=0){ return $id!==99; }
function add_query_arg($a,$u){ return $u.'?'.http_build_query($a); }
function add_action(){} function register_rest_route(){}
${fs.readFileSync(path.join(DIR, 'includes', 'editor.php'), 'utf8').replace(/^<\?php/, '')}
${body}
`);
  try { return execFileSync('php', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const J = (s) => JSON.parse(s.trim());

test('destino: solo post.php y post-new.php de wp-admin de esta web', { skip: !hasPhp }, () => {
  const out = J(run(`
$B='https://web.example/wp-admin/'; $c=array(
 'post.php?post=12&action=edit', 'https://web.example/wp-admin/post.php?post=12&action=edit', '/wp-admin/post.php?post=5', 'post-new.php', 'post-new.php?post_type=page',
 'https://evil.example/wp-admin/post.php?post=1&action=edit', '//evil.example/wp-admin/post.php?post=1', 'http://web.example/wp-admin/post.php?post=1',
 'https://web.example:8443/wp-admin/post.php?post=1', 'https://user@web.example/wp-admin/post.php?post=1',
 'plugins.php', 'users.php', 'admin-ajax.php', 'post.php?post=abc', 'post.php', 'post.php?post=0', 'post.php?post=3&action=delete', 'post-new.php?post_type=shop_order',
 'javascript:alert(1)', 'https://web.example/wp-admin/../wp-login.php', 'https://web.example/wp-admin/post.php?post=1#x', '', 'post.php?post=1 ', "post.php?post=1\\n");
$o=array(); foreach($c as $t){ $o[]=ecos_wp_editor_clean_target($t,$B); } echo json_encode($o);`));
  assert.deepEqual(out.slice(0, 5), [
    'https://web.example/wp-admin/post.php?post=12&action=edit', 'https://web.example/wp-admin/post.php?post=12&action=edit',
    'https://web.example/wp-admin/post.php?post=5&action=edit', 'https://web.example/wp-admin/post-new.php', 'https://web.example/wp-admin/post-new.php?post_type=page']);
  assert.deepEqual(out.slice(5), Array(out.length - 5).fill(''));
});

test('token: se guarda solo el hash, dura 60 s, es de un solo uso y se borra aunque falle', { skip: !hasPhp }, () => {
  const r = J(run(`
$t = ecos_wp_editor_make_token(7, 'post.php?post=12&action=edit');
$keys = array_keys($GLOBALS['T']); $ttl = $GLOBALS['T'][$keys[0]][1];
$first = ecos_wp_editor_consume_token($t); $second = ecos_wp_editor_consume_token($t);
echo json_encode(array('len'=>strlen($t), 'hex'=>(bool)preg_match('/^[a-f0-9]{64}$/',$t), 'keys'=>$keys, 'ttl'=>$ttl, 'inKey'=>strpos($keys[0], $t)!==false,
  'first'=>$first, 'second'=>$second, 'left'=>count($GLOBALS['T'])));`));
  assert.equal(r.len, 64); assert.ok(r.hex); assert.equal(r.keys.length, 1); assert.equal(r.ttl, 60);
  assert.equal(r.inKey, false); assert.match(r.keys[0], /^ecos_ed_[a-f0-9]{64}$/);
  assert.deepEqual(r.first, { user: 7, target: 'https://web.example/wp-admin/post.php?post=12&action=edit' });
  assert.equal(r.second, false); assert.equal(r.left, 0);
});

test('token caducado, inventado o de otro destino: se rechaza', { skip: !hasPhp }, () => {
  const r = J(run(`
$t = ecos_wp_editor_make_token(7, 'post.php?post=12&action=edit');
unset($GLOBALS['T']['ecos_ed_'.ecos_wp_editor_hash($t)]); // caducado: WordPress ya no lo devuelve
$expired = ecos_wp_editor_consume_token($t);
$fake = ecos_wp_editor_consume_token(str_repeat('a',64)); $short = ecos_wp_editor_consume_token('abc'); $arr = ecos_wp_editor_consume_token(array('x'));
$ext = ecos_wp_editor_make_token(7, 'https://evil.example/wp-admin/post.php?post=1&action=edit'); $users = ecos_wp_editor_make_token(7, 'users.php'); $anon = ecos_wp_editor_make_token(0, 'post.php?post=1');
// un token guardado con destino manipulado tampoco vale
$GLOBALS['T']['ecos_ed_'.ecos_wp_editor_hash(str_repeat('b',64))] = array(array('user'=>7,'target'=>'https://evil.example/x'),60);
$bad = ecos_wp_editor_consume_token(str_repeat('b',64));
echo json_encode(compact('expired','fake','short','arr','ext','users','anon','bad'));`));
  for (const k of Object.keys(r)) assert.equal(r[k], false, k);
});

test('ruta REST: devuelve la dirección de admin-post con el token, rechaza destinos ajenos y entradas sin permiso', { skip: !hasPhp }, () => {
  const r = J(run(`
$ok = ecos_wp_rest_editor_session(new WP_REST_Request(array('target'=>'post.php?post=12&action=edit')));
$ext = ecos_wp_rest_editor_session(new WP_REST_Request(array('target'=>'https://evil.example/')));
$no = ecos_wp_rest_editor_session(new WP_REST_Request(array('target'=>'post.php?post=99&action=edit')));
$new = ecos_wp_rest_editor_session(new WP_REST_Request(array('target'=>'post-new.php')));
echo json_encode(array('ok'=>$ok, 'ext'=>is_object($ext)?$ext->c:'', 'no'=>is_object($no)?$no->c:'', 'new'=>$new['plugin'] ?? '', 'n'=>count($GLOBALS['T'])));`));
  assert.match(r.ok.url, /^https:\/\/web\.example\/wp-admin\/admin-post\.php\?action=ecos_editor&t=[a-f0-9]{64}$/);
  assert.equal(r.ok.expires, 60); assert.equal(r.ext, 'ecos_bad_target'); assert.equal(r.no, 'ecos_forbidden'); assert.equal(r.new, 'ecos'); assert.equal(r.n, 2);
});
