import type { DocumentHead } from '@qwik.dev/router';
import { component$, useStyles$ } from '@qwik.dev/core';
import styles from './index.css?inline';

export default component$(() => {
	useStyles$(styles);

	return (
		<div>
			<h1>Google provider</h1>
			<div>Poppins</div>
			<p>Press Start 2P</p>
		</div>
	);
});

export const head: DocumentHead = {
	title: 'Welcome to Qwik',
	meta: [
		{
			name: 'description',
			content: 'Qwik site description',
		},
	],
};
