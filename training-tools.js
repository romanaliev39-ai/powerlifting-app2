(() => {
  'use strict';

  const number = (name, label, value, min = 0, max = 1000, step = 'any') =>
    ({ name, label, value, min, max, step });
  const select = (name, label, options) => ({ name, label, options });
  const sex = select('sex', 'Формула', ['Мужская', 'Женская']);
  const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const show = (value, unit = '') => format.format(value) + (unit ? ' ' + unit : '');
  const row = (label, value) => label + ' — ' + value;
  const epley = (kg, reps) => reps === 1 ? kg : kg * (1 + reps / 30);
  const pct = (part, total) => show(part / total * 100, '%');
  const bodyFat = value => {
    if (!Number.isFinite(value) || value <= 0 || value >= 75) {
      throw new Error('Проверьте единицы и окружности или толщину складок.');
    }
    return [row('Оценка доли жира', show(value, '%'))];
  };

  function plateResult({ target, bar, inventory }) {
    if (target < bar) throw new Error('Целевой вес меньше веса пустого грифа.');
    const items = inventory.trim().split(/[;\n]+/).filter(Boolean);
    if (items.length > 25) throw new Error('Укажите до 25 размеров блинов.');
    const counts = new Map();
    for (const item of items) {
      const match = item.trim().match(/^(\d+(?:[.,]\d{1,2})?)\s*:\s*(\d+)$/);
      if (!match) throw new Error('Формат списка — вес в кг : число пар. Разделяйте размеры точкой с запятой.');
      const mass = Math.round(Number(match[1].replace(',', '.')) * 100);
      const pairs = Number(match[2]);
      if (mass < 25 || mass > 5000 || pairs > 50) throw new Error('Допустимы блины от 0,25 до 50 кг и до 50 пар каждого размера.');
      counts.set(mass, (counts.get(mass) || 0) + pairs);
    }
    const goal = Math.round((target - bar) * 50);
    const cap = goal + Math.max(0, ...counts.keys());
    const combinations = new Map([[0, []]]);
    for (const [mass, pairs] of [...counts].sort((a, b) => b[0] - a[0])) {
      for (const [sum, existing] of [...combinations]) {
        for (let count = 1; count <= pairs && sum + count * mass <= cap; count++) {
          const next = sum + count * mass;
          const candidate = [...existing, ...Array(count).fill(mass)];
          if (!combinations.has(next) || combinations.get(next).length > candidate.length) {
            combinations.set(next, candidate);
          }
        }
      }
    }
    const nearest = [...combinations.keys()].reduce((best, sum) => {
      const difference = Math.abs(sum - goal) - Math.abs(best - goal);
      return difference < 0 || (difference === 0 && sum < best) ? sum : best;
    });
    const perSide = combinations.get(nearest);
    const actual = bar + nearest / 50;
    return [
      row(Math.abs(actual - target) < 0.0001 ? 'Вес штанги' : 'Ближайший доступный вес', show(actual, 'кг')),
      row('На каждую сторону', perSide.length ? perSide.map(mass => show(mass / 100, 'кг')).join(' + ') : 'без блинов')
    ];
  }

  function volumeResult({ sets }) {
    const totals = new Map();
    for (const line of sets.split('\n').map(text => text.trim()).filter(Boolean)) {
      const [exercise, count, reps, kg, ...extra] = line.split(';').map(value => value.trim());
      const values = [count, reps, kg].map(value => value && Number(value.replace(',', '.')));
      if (extra.length || !exercise || values.some(value => !Number.isFinite(value) || value <= 0) ||
          !Number.isInteger(values[0]) || !Number.isInteger(values[1])) {
        throw new Error('Каждая строка должна содержать название, подходы, повторения и вес через точку с запятой.');
      }
      const [n, r, w] = values;
      const total = totals.get(exercise) || { sets: 0, reps: 0, kg: 0 };
      total.sets += n;
      total.reps += n * r;
      total.kg += n * r * w;
      totals.set(exercise, total);
    }
    if (!totals.size) throw new Error('Добавьте хотя бы один подход.');
    const items = [...totals];
    const sum = items.reduce((total, [, value]) => total + value.kg, 0);
    return [row('Общий тоннаж', show(sum, 'кг')), ...items.map(([name, value]) =>
      row(name, show(value.sets) + ' подх. · ' + show(value.reps) + ' повт. · ' + show(value.kg, 'кг')))];
  }

  const groups = [
    {
      title: 'Силовая подготовка',
      tools: [
        { id: 'one-rm', title: 'Расчёт 1ПМ', hint: 'Введите вес подхода и число повторений. Для оценки лучше использовать 2–10 повторений, выполненных близко к пределу.',
          fields: [number('kg', 'Вес подхода, кг', 80, 0.25), number('reps', 'Повторения', 5, 1, 10, 1)],
          calculate: ({ kg, reps }) => {
            const estimate = epley(kg, reps);
            return [row('Эпли', show(estimate, 'кг')), row('Бжицки', show(kg * 36 / (37 - reps), 'кг')),
              row('Рабочие веса по Эпли', [65, 75, 85, 90].map(p => p + '% · ' + show(estimate * p / 100, 'кг')).join(' | '))];
          } },
        { id: 'progression', title: 'Прогрессия рабочего веса', hint: 'Правило двойной прогрессии для последнего рабочего подхода. Прибавка применяется, когда достигнута верхняя граница и остался запас.',
          fields: [number('kg', 'Текущий вес, кг', 80, 0.25), number('reps', 'Выполнено повторений', 8, 1, 50, 1),
            number('min', 'Нижняя граница повторений', 6, 1, 50, 1), number('max', 'Верхняя граница повторений', 8, 1, 50, 1),
            number('rpe', 'Усилие RPE', 8, 1, 10, 0.5), number('step', 'Прибавка, кг', 2.5, 0.25, 20)],
          calculate: ({ kg, reps, min, max, rpe, step }) => {
            if (min > max) throw new Error('Нижняя граница должна быть не выше верхней.');
            if (reps >= max && rpe <= 8) return [row('Следующий рабочий вес', show(kg + step, 'кг')), 'Верхняя граница достигнута с запасом.'];
            if (reps < min && rpe >= 9) return [row('Следующий рабочий вес', show(Math.max(kg - step, 0.25), 'кг')), 'Повторений меньше цели, а усилие близко к максимуму.'];
            return [row('Следующий рабочий вес', show(kg, 'кг')), 'Сохраните вес и проверьте повторения на следующей тренировке.'];
          } },
        { id: 'volume', title: 'Недельный объём', hint: 'Укажите выполненные подходы за неделю. Тоннаж — сумма веса, умноженного на число повторений в каждом подходе.',
          fields: [{ name: 'sets', label: 'Упражнение; подходы; повторения; вес, кг', multiline: true, placeholder: 'Присед; 3; 5; 100' }],
          calculate: volumeResult },
        { id: 'bench', title: 'Подводка в жиме лёжа', hint: 'Пример четырёхнедельной подводки с уменьшением объёма к тесту. Вес округляется до указанного шага.',
          fields: [number('rm', 'Текущий 1ПМ, кг', 100, 1), number('step', 'Шаг веса, кг', 2.5, 0.25, 20)],
          calculate: ({ rm, step }) => [[1, 4, 4, 77.5], [2, 4, 3, 82.5], [3, 3, 2, 87.5], [4, 2, 1, 75]].map(
            ([week, sets, reps, intensity]) => row('Неделя ' + week, sets + ' × ' + reps + ' · ' + show(intensity, '%') +
              ' · ' + show(Math.round(rm * intensity / 100 / step) * step, 'кг'))
          ).concat('Тест максимума — отдельная тренировка после восстановления.') },
        { id: 'plates', title: 'Подбор блинов', hint: 'Блины подбираются симметрично. Указывайте число доступных пар каждого размера.',
          fields: [number('target', 'Целевой вес штанги, кг', 100, 0.25, 500), number('bar', 'Вес грифа и замков, кг', 20, 0.25, 100),
            { name: 'inventory', label: 'Вес блина : число пар', multiline: true, value: '25:2; 20:2; 15:1; 10:1; 5:1; 2,5:1; 1,25:1' }],
          calculate: plateResult }
      ]
    },
    {
      title: 'Состав тела и пропорции',
      tools: [
        { id: 'navy', title: 'Процент жира по обхватам', hint: 'Оценка US Navy для взрослых. Для мужской формулы измерьте живот на уровне пупка, для женской — талию в самом узком месте.',
          source: 'https://media.defense.gov/2025/Feb/07/2003642977/-1/-1/0/CI_1020_8I.PDF',
          fields: [sex, number('height', 'Рост, см', '', 100, 240), number('neck', 'Шея, см', '', 15, 85),
            number('waist', 'Талия или живот, см', '', 35, 250), { ...number('hips', 'Бёдра, см', '', 35, 250), femaleOnly: true }],
          calculate: ({ sex, height, neck, waist, hips }) => {
            const difference = (waist + (sex === 'Женская' ? hips : 0) - neck) / 2.54;
            const h = Math.log10(height / 2.54);
            return bodyFat(sex === 'Женская' ? 163.205 * Math.log10(difference) - 97.684 * h - 78.387 :
              86.010 * Math.log10(difference) - 70.041 * h + 36.76);
          } },
        { id: 'skinfold', title: 'Процент жира по кожным складкам', hint: 'Трёхточечная формула Джексона—Поллока и пересчёт Сири. Мужчины: грудь, живот, бедро. Женщины: трицепс, надподвздошная складка, бедро.',
          source: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10453806/',
          fields: [sex, number('age', 'Возраст, лет', '', 18, 65, 1), ...[1, 2, 3].map(i => number('fold' + i, 'Складка ' + i + ', мм', '', 1, 65))],
          calculate: ({ sex, age, fold1, fold2, fold3 }) => {
            const sum = fold1 + fold2 + fold3;
            const density = sex === 'Женская' ? 1.0994921 - 0.0009929 * sum + 0.0000023 * sum ** 2 - 0.0001392 * age :
              1.10938 - 0.0008267 * sum + 0.0000016 * sum ** 2 - 0.0002574 * age;
            return bodyFat(495 / density - 450);
          } },
        { id: 'proportions', title: 'Пропорции тела', hint: 'Сравните собственные замеры. Повторяйте измерения в одних и тех же точках.',
          fields: [['height','Рост'],['chest','Грудь'],['waist','Талия'],['hips','Бёдра'],['arm','Плечо (обхват руки)'],['thigh','Бедро']].map(
            ([key, label]) => number(key, label + ', см', '', 10, 250)),
          calculate: v => [row('Талия / рост', pct(v.waist, v.height)), row('Талия / бёдра', pct(v.waist, v.hips)),
            row('Грудь / талия', pct(v.chest, v.waist)), row('Плечо / бедро', pct(v.arm, v.thigh))] },
        { id: 'anthropometry', title: 'Антропометрия для техники', hint: 'Измерьте бедро от тазобедренного сустава до колена, голень от колена до лодыжки, туловище от тазобедренного сустава до плеча.',
          fields: [['height','Рост'],['span','Размах рук'],['femur','Бедро'],['shin','Голень'],['torso','Туловище']].map(
            ([key, label]) => number(key, label + ', см', '', 10, 250)),
          calculate: v => [row('Бедро / голень', show(v.femur / v.shin)), row('Бедро / туловище', show(v.femur / v.torso)),
            row('Размах рук относительно роста', pct(v.span, v.height)),
            'В приседе сравните наклон корпуса и глубину при разной стойке. Для тяги и жима сравните амплитуду по видео подхода. Пропорции сами по себе не определяют подходящую технику.'] },
        { id: 'deficit', title: 'Дефицит и сроки', hint: 'Расчёт для взрослых. Срок при заданном темпе и условный энергетический эквивалент без учёта адаптации организма.',
          source: 'https://www.niddk.nih.gov/health-information/professionals/diabetes-discoveries-practice/nih-body-weight-planner',
          fields: [number('current', 'Текущий вес, кг', '', 35, 350), number('target', 'Целевой вес, кг', '', 35, 350),
            number('rate', 'Планируемое снижение, кг в неделю', 0.4, 0.1, 1)],
          calculate: ({ current, target, rate }) => {
            if (target >= current) throw new Error('Целевой вес должен быть ниже текущего.');
            return [row('При заданном темпе', show((current - target) / rate, 'нед.')),
              row('Условный эквивалент дефицита', show(Math.round(rate * 7700 / 7), 'ккал/день')),
              'Фактический срок меняется. Расчёт не задаёт норму калорий.'];
          } }
      ]
    }
  ];

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function open(id, initial = {}) {
    const dialog = document.getElementById('training-tools-dialog');
    const content = dialog.querySelector('.training-tools-content');
    content.replaceChildren();
    if (!id) {
      for (const group of groups) {
        content.append(element('h3', group.title));
        const list = element('div');
        list.className = 'training-tools-grid';
        for (const tool of group.tools) {
          const button = element('button', tool.title);
          button.type = 'button';
          button.addEventListener('click', () => open(tool.id));
          list.append(button);
        }
        content.append(list);
      }
    } else {
      const tool = groups.flatMap(group => group.tools).find(item => item.id === id);
      if (!tool) return;
      const back = element('button', 'Все инструменты');
      back.type = 'button';
      back.addEventListener('click', () => open());
      content.append(back, element('h3', tool.title), element('p', tool.hint));
      const form = element('form');
      for (const f of tool.fields) {
        const label = element('label', f.label);
        const input = element(f.options ? 'select' : f.multiline ? 'textarea' : 'input');
        input.name = f.name;
        input.required = !f.femaleOnly;
        if (f.options) {
          for (const option of f.options) input.append(element('option', option));
        } else if (f.multiline) {
          input.rows = 4;
          input.maxLength = 12000;
          input.placeholder = f.placeholder || '';
        } else {
          input.type = 'number';
          input.min = f.min;
          input.max = f.max;
          input.step = f.step;
        }
        input.value = initial[f.name] ?? f.value ?? f.options?.[0] ?? '';
        if (f.femaleOnly) label.dataset.femaleOnly = 'true';
        label.append(input);
        form.append(label);
      }
      const updateFields = () => {
        for (const label of form.querySelectorAll('[data-female-only]')) {
          const enabled = form.elements.sex.value === 'Женская';
          label.hidden = !enabled;
          label.lastElementChild.required = enabled;
          label.lastElementChild.disabled = !enabled;
        }
      };
      form.addEventListener('change', updateFields);
      updateFields();
      if (id === 'volume' && typeof window.getTrainingVolumeRows === 'function' && window.currentUser && !window.isAdmin) {
        const fill = element('button', 'Подставить выполненные подходы');
        fill.type = 'button';
        fill.addEventListener('click', () => {
          const rows = window.getTrainingVolumeRows();
          if (rows.length) form.elements.sets.value = rows.join('\n');
          result.textContent = rows.length ? 'Подходы подставлены. Проверьте список и нажмите «Рассчитать».' :
            'Нет отмеченных подходов с доступным весом за выбранную неделю.';
        });
        form.append(fill);
      }
      const submit = element('button', 'Рассчитать');
      submit.type = 'submit';
      form.append(submit);
      const result = element('output');
      result.setAttribute('aria-live', 'polite');
      form.addEventListener('submit', event => {
        event.preventDefault();
        result.replaceChildren();
        try {
          const values = Object.fromEntries(tool.fields.map(f => [
            f.name, f.options || f.multiline ? form.elements[f.name].value : form.elements[f.name].valueAsNumber
          ]));
          for (const line of tool.calculate(values)) result.append(element('p', line));
        } catch (error) {
          result.textContent = error.message;
        }
      });
      content.append(form, result);
      if (tool.source) {
        const link = element('a', 'Об источнике расчёта');
        link.href = tool.source;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        content.append(link);
      }
    }
    if (!dialog.open) dialog.showModal();
    content.querySelector('h3')?.setAttribute('tabindex', '-1');
    content.querySelector('h3')?.focus();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-training-tools]');
    if (!button) return;
    const target = button.classList.contains('training-plate-weight')
      ? Number(button.textContent.match(/^\d+(?:[.,]\d+)?/)?.[0].replace(',', '.')) : NaN;
    open(button.dataset.trainingTools, Number.isFinite(target) && target > 0 ? { target } : {});
  });
})();
