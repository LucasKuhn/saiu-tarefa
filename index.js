const cool = require('cool-ascii-faces');
const express = require('express');
const path = require('path');
const PORT = process.env.PORT || 5000;
const playwright = require('playwright');
const ORGANIZADORA_F5 = 'https://www.equipeorganizadoraf5.com.br';

// Whatsapp ( https://wwebjs.dev/)
const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');
const wclient = new Client({
	puppeteer: {
		args: ['--no-sandbox'],
	}
});
wclient.on('qr', qr => {
	qrcode.generate(qr, { small: true });
});
wclient.on('ready', () => {
	console.log('Whatsapp client is ready!');
});
wclient.initialize();

const { Pool } = require('pg');
const pool = (() => {
	if (process.env.NODE_ENV !== 'production') {
		return new Pool({
			connectionString: process.env.DATABASE_URL,
			database: 'arriba',
			ssl: false
		});
	} else {
		return new Pool({
			connectionString: process.env.DATABASE_URL,
			ssl: {
				rejectUnauthorized: false
			}
		});
	}
})();

const getTasks = async () => {
	const client = await pool.connect();
	const browser = await playwright.chromium.launch({
		headless: true
	});
	const page = await browser.newPage({ acceptDownloads: true, baseURL: "https://www.equipeorganizadoraf5.com.br" });
	await page.goto("gincanas/2");

	console.log("Opened page");
	var title = await page.title();
	while (!title.includes("Tarefas")) {
		console.log("Waiting...");
		await page.waitForTimeout(2000);
		title = await page.title();
	}

	const tasks = await page.$$eval('.table-tasks tbody tr', (trs) => {
		return trs.map(tr => {
			return {
				number: tr.querySelector('td:first-child')?.textContent,
				name: tr.querySelector('a')?.textContent,
				pdf_path: tr.querySelector('a')?.getAttribute('href'),
				category: tr.getAttribute('data-category'),
				published_at: tr.querySelector('td:last-child')?.textContent,
			}
		});
	});
	return (tasks);
}

const taskExists = async (number) => {
	var query = `
	SELECT 1
	FROM tasks
	WHERE number = ${number};
	`;
	const client = await pool.connect();
	const result = await client.query(query);
	client.release();
	return(result.rowCount);
}

const categoryName = (category) => {
	switch (category) {
		case '1':	return '🎭 Artísticas';
		case '2':	return '💡 Charadas';
		case '3':	return '🔍 Diversas';
		case '4':	return '🎾 Esportivas';
		case '5':	return '🏺 Objetos';
		case '6':	return '🔦 Rua';
		case '7':	return '🎯 Alternativas';
	}
}

const sendWhatsapp = async (task) => {
	const message = `
Nova tarefa: ${categoryName(task.category)}
${task.number} - ${task.name}
${ORGANIZADORA_F5}${task.pdf_path}
`;
	console.log("Sendind whatsapp message... (task " + task.number + ")");
	await wclient.sendMessage('555499473217-1533736115@g.us', message);
}

const crawl = async () => {
	console.log("Crawling started!");
	const tasks = await getTasks();
	console.log(`Found ${tasks.length} tasks`);
	tasks.forEach(async (task) => {
		if (await taskExists(task.number)) {
			console.log(`Task ${task.number} already exists`);
			return;
		}
		console.log(`New task (${task.number})`);
		const query = `
			INSERT INTO tasks (number, name, pdf_path, category, published_at)
			VALUES ($1, $2, $3, $4, $5);
		`;
		const values = [task.number, task.name, task.pdf_path, task.category, task.published_at];
		const client = await pool.connect();
		const result = await client.query(query, values);
		client.release();
		await sendWhatsapp(task);
	});
	console.log("Crawling finished!"); 
};

express()
	.use(express.static(path.join(__dirname, 'public')))
	.set('views', path.join(__dirname, 'views'))
	.set('view engine', 'ejs')
	.get('/start', (req, res) => res.render('pages/index'))
	.get('/', (req, res) => res.send(cool()))
	.get('/db', async (req, res) => {
		try {
			const client = await pool.connect();
			const result = await client.query('SELECT * FROM tasks');
			const results = { 'results': (result) ? result.rows : null };
			console.log(results);
			res.render('pages/db', results);
			client.release();
		} catch (err) {
			console.error(err);
			res.send("Error " + err);
		}
	})
	.get('/crawl', async (req, res) => {
		try {
			crawl();
			res.send("Crawling 🤖");
		} catch (err) {
			console.error(err);
			res.send("Error " + err);
		}
	})
	.listen(PORT, () => console.log(`Listening on ${PORT}`));
