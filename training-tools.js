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

  const lifts = [['squat','Присед'],['bench','Жим'],['dead','Тяга']];
  const ipfFormats = ['Классическое троеборье','Экипировочное троеборье','Классический жим','Экипировочный жим'];
  const ipfCoefficients = {
    Мужская: [[1199.72839,1025.18162,.00921],[1236.25115,1449.21864,.01644],[320.98041,281.40258,.01008],[381.22073,733.79378,.02398]],
    Женская: [[610.32796,1045.59282,.03048],[758.63878,949.31382,.02435],[142.40398,442.52671,.04724],[221.82209,357.00377,.02937]]
  };
  const attemptStatuses = ['Запланирован','Зачёт','Незачёт'];
  function ipfGl({ sex, format, body, total }) {
    const [a,b,c] = ipfCoefficients[sex][ipfFormats.indexOf(format)];
    const divisor = a - b * Math.exp(-c * body);
    if(!(divisor > 0)) throw new Error('Проверьте массу тела и формат.');
    return [row('IPF GL', show(100 * total / divisor) + ' балла')];
  }
  function competitionResult(values) {
    let projectedTotal = 0, acceptedTotal = 0;
    let projectedLifts = 0, acceptedLifts = 0;
    const results = [];
    for(const [key, name] of lifts) {
      const attempts = [1,2,3].map(n => ({kg:values[key+n], status:values[key+n+'status'] || 'Запланирован'}));
      for(const attempt of attempts) {
        if(attempt.status !== 'Запланирован' && !(attempt.kg > 0)) {
          throw new Error('Укажите вес для отмеченного зачёта или незачёта.');
        }
      }
      const projected = Math.max(0, ...attempts.filter(a => a.status !== 'Незачёт' && a.kg > 0).map(a => a.kg));
      const accepted = Math.max(0, ...attempts.filter(a => a.status === 'Зачёт').map(a => a.kg));
      if(projected){ projectedLifts++; projectedTotal += projected; }
      if(accepted){ acceptedLifts++; acceptedTotal += accepted; }
      results.push(row(name, 'в зачёте ' + (accepted ? show(accepted,'кг') : '—') + ' · возможный результат ' + (projected ? show(projected,'кг') : '—')));
      const opener = attempts[0].kg;
      if(opener > 0) {
        const bar = values.bar, step = values.warmupStep;
        const warmup = [...new Set([bar, ...[.4,.6,.75,.87].map(p=>bar + Math.round((opener*p-bar)/step)*step)])]
          .filter(kg=>kg>=bar && kg<opener).sort((a,b)=>a-b);
        if(warmup.length) results.push(row('Разминка · '+name, warmup.map(kg=>show(kg,'кг')).join(' → ')));
      }
    }
    return [
      row('Зачётная сумма', acceptedLifts === 3 ? show(acceptedTotal,'кг') : 'нужен зачёт во всех трёх движениях'),
      row('Возможная сумма', projectedLifts === 3 ? show(projectedTotal,'кг') : 'укажите попытку в каждом движении'),
      ...results
    ];
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

  groups.push(
    {title:'История тренировок',tools:[
      {id:'strength-history',title:'График силы',hint:'Лучшая оценка 1ПМ за тренировку по формуле Эпли. Учитываются записанные подходы до 10 повторений.',render:renderStrengthHistory},
      {id:'compare-weeks',title:'Сравнение недель',hint:'Сравните две календарные недели с понедельника по воскресенье.',render:renderWeekComparison}
    ]},
    {title:'Соревнования',tools:[
      {id:'meet-planner',title:'Планировщик соревнований',hint:'Запишите веса и статусы попыток. Разминка показана как пример весов до первой попытки.',
        source:'https://www.powerlifting.sport/rules/codes/info/technical-rules',
        fields:[number('bar','Вес грифа, кг',20,0.25,100),number('warmupStep','Шаг веса для разминки, кг',2.5,.25,20),
          ...lifts.flatMap(([key, name])=>[1,2,3].flatMap(n=>[
          {...number(key+n,name+' · попытка '+n+', кг','',0.25),optional:true},
          select(key+n+'status','Статус попытки '+n,attemptStatuses)
        ]))],calculate:competitionResult},
      {id:'ipf-gl',title:'Очки IPF GL',hint:'Введите вес тела и зачётную сумму троеборья или результат отдельного жима.',
        source:'https://www.powerlifting.sport/rules/codes/info/ipf-formula',
        fields:[select('sex','Категория',['Мужская','Женская']),select('format','Формат',ipfFormats),
          number('body','Вес тела, кг','',30,350),number('total','Зачётный результат, кг','',0.25,2000)],calculate:ipfGl}
    ]}
  );

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
      if (tool.render) tool.render(content);
      else renderCalculator(content, tool, initial);
    }
    if (!dialog.open) dialog.showModal();
    content.querySelector('h3')?.setAttribute('tabindex', '-1');
    content.querySelector('h3')?.focus();
  }

  function renderCalculator(content, tool, initial) {
      const id = tool.id;
      const form = element('form');
      for (const f of tool.fields) {
        const label = element('label', f.label);
        const input = element(f.options ? 'select' : f.multiline ? 'textarea' : 'input');
        input.name = f.name;
        input.required = !f.femaleOnly && !f.optional;
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

  function historyForTool(content) {
    const history = window.getTrainingToolHistory?.();
    if (!history) {
      content.append(element('p', 'Откройте «Аналитика», выберите спортсмена и снова откройте инструмент.'));
      return null;
    }
    content.append(element('p', history.name));
    return history.sets;
  }

  const hasLoad = set => Number.isFinite(set.kg) && set.kg >= 0 && Number.isInteger(set.reps) && set.reps > 0;
  const hasDate = set => Number.isFinite(set.performedAt) && set.performedAt > 0;
  const shortDate = new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
  function dateValue(timestamp) {
    const d = new Date(timestamp);
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }
  function labeledControl(parent, title, control) {
    const label = element('label', title);
    label.append(control);
    parent.append(label);
  }
  function makeHistoryTable(title, columns, rows) {
    const table = element('table');
    table.className = 'training-history-table';
    if(title) table.append(element('caption',title));
    const head = element('thead'), header = element('tr'), body = element('tbody');
    columns.forEach(column => {
      const th = element('th',column);
      th.scope = 'col';
      header.append(th);
    });
    head.append(header);
    rows.forEach(values => {
      const tr = element('tr');
      values.forEach(value => {
        const td = element('td');
        if(typeof value === 'string') td.textContent = value;
        else td.append(value);
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(head,body);
    return table;
  }
  function strengthPoints(sets, exercise) {
    const points = new Map();
    for(const set of sets) {
      if(set.exercise !== exercise || set.estimated || !hasLoad(set) || !hasDate(set) || set.kg <= 0 || set.reps > 10) continue;
      const day = dateValue(set.performedAt);
      const key = set.workoutId + '|' + day;
      const value = epley(set.kg,set.reps);
      if(!points.has(key) || points.get(key).value < value) points.set(key,{...set,value});
    }
    return [...points.values()].sort((a,b)=>a.performedAt-b.performedAt);
  }
  function strengthChart(points, activate) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 540 185');
    svg.setAttribute('aria-label','График расчётного 1ПМ. Подходы доступны в таблице ниже.');
    svg.setAttribute('role','img');
    svg.classList.add('training-history-chart');
    function add(tag, attributes, label) {
      const node = document.createElementNS(svg.namespaceURI,tag);
      Object.entries(attributes).forEach(([key,value])=>node.setAttribute(key,value));
      if(label) node.textContent = label;
      svg.append(node);
      return node;
    }
    const min = Math.min(...points.map(p=>p.value)), max = Math.max(...points.map(p=>p.value));
    const lower = Math.max(0, Math.floor(min/5)*5-5), upper = Math.ceil(max/5)*5+5;
    const start = points[0].performedAt, end = points[points.length-1].performedAt;
    const x = p => start === end ? 282 : 55 + (p.performedAt-start)/(end-start)*468;
    const y = value => 153 - (value-lower)/(upper-lower)*126;
    [lower,(lower+upper)/2,upper].forEach(value=>{
      add('line',{x1:54,x2:526,y1:y(value),y2:y(value),stroke:'currentColor',opacity:'.2'});
      add('text',{x:4,y:y(value)+4,fill:'currentColor','font-size':12},show(value,'кг'));
    });
    add('polyline',{points:points.map(p=>x(p)+','+y(p.value)).join(' '),fill:'none',stroke:'var(--accent, #e44)', 'stroke-width':3});
    points.forEach(p=> {
      const dot = add('circle',{cx:x(p),cy:y(p.value),r:5,fill:'var(--accent, #e44)',style:'cursor:pointer'});
      dot.addEventListener('click',()=>activate(p));
    });
    return svg;
  }
  function renderStrengthHistory(content) {
    const sets = historyForTool(content);
    if(!sets) return;
    const exercises = [...new Set(sets.filter(s=>!s.estimated && hasDate(s) && hasLoad(s) && s.kg > 0 && s.reps <= 10).map(s=>s.exercise))];
    if(!exercises.length) {
      content.append(element('p','Пока нет сохранённых подходов с весом и 1–10 повторениями.'));
      return;
    }
    const controls = element('div'), selector = element('select'), result = element('div');
    controls.className = 'training-history-controls';
    exercises.sort((a,b)=>a.localeCompare(b,'ru')).forEach(name=>selector.append(element('option',name)));
    labeledControl(controls,'Упражнение',selector);
    content.append(controls,result);
    function render() {
      const points = strengthPoints(sets,selector.value);
      const detail = element('p');
      detail.className = 'training-history-detail';
      detail.setAttribute('aria-live','polite');
      function activate(point) {
        detail.textContent = point.workoutTitle + ' · подход ' + (point.index+1) + ' · ' + show(point.kg,'кг') + ' × ' + point.reps +
          (point.rpe != null ? ' · RPE ' + show(point.rpe) : '') + ' · расчётный 1ПМ ' + show(point.value,'кг');
      }
      const rows = points.map(point=>{
        const button = element('button','Подход '+(point.index+1));
        button.type = 'button';
        button.addEventListener('click',()=>activate(point));
        return [shortDate.format(point.performedAt),show(point.value,'кг'),button];
      });
      result.replaceChildren(strengthChart(points,activate),detail,makeHistoryTable('', ['Дата','Расчётный 1ПМ','Подход'],rows));
      activate(points[points.length-1]);
    }
    selector.addEventListener('change',render);
    render();
  }

  function weekBounds(value) {
    if(!value) return null;
    const start = new Date(value+'T00:00:00');
    if(!Number.isFinite(+start)) return null;
    start.setDate(start.getDate()-(start.getDay()+6)%7);
    const end = new Date(start);
    end.setDate(end.getDate()+7);
    return [start,end];
  }
  function summarizeWeek(sets, bounds) {
    const result = new Map();
    if(!bounds) return result;
    for(const set of sets) {
      if(!hasDate(set) || set.performedAt < +bounds[0] || set.performedAt >= +bounds[1]) continue;
      const group = result.get(set.exercise) || {kg:0,count:0,unknown:0,estimated:0,best:null};
      if(hasLoad(set)) {
        group.kg += set.kg * set.reps;
        group.count++;
        if(set.estimated) group.estimated++;
        if(!group.best || set.kg > group.best.kg || (set.kg === group.best.kg && set.reps > group.best.reps)) group.best = set;
      }else group.unknown++;
      result.set(set.exercise,group);
    }
    return result;
  }
  function renderWeekComparison(content) {
    const sets = historyForTool(content);
    if(!sets) return;
    const controls = element('div'), first = element('input'), second = element('input'), result = element('div');
    const undated = sets.filter(set=>!hasDate(set)).length;
    if(undated) content.append(element('p','Без даты выполнения: '+undated+'. Эти подходы не входят в календарное сравнение.'));
    const latest = sets.reduce((max,set)=>hasDate(set)?Math.max(max,set.performedAt):max,0);
    const previous = new Date(latest || Date.now());
    previous.setDate(previous.getDate()-7);
    first.type = second.type = 'date';
    first.value = dateValue(+previous);
    second.value = dateValue(latest || Date.now());
    controls.className = 'training-history-controls';
    labeledControl(controls,'Дата в первой неделе',first);
    labeledControl(controls,'Дата во второй неделе',second);
    content.append(controls,result);
    if(sets.some(set=>set.estimated)) content.append(element('p','Расчётные подходы из старых отчётов сгруппированы по дате сохранения.'));
    const metric = g => !g ? '—' : (g.count ? show(g.kg,'кг') : '—') + ' · подходов: ' + g.count +
      (g.best ? ' · макс. ' + show(g.best.kg,'кг') + ' × ' + g.best.reps : '') +
      (g.estimated ? ' · расчётных: ' + g.estimated : '') + (g.unknown ? ' · без данных: ' + g.unknown : '');
    function render(){
      const boundsA=weekBounds(first.value), boundsB=weekBounds(second.value);
      if(!boundsA || !boundsB){ result.replaceChildren(element('p','Выберите обе даты.'));return; }
      const a=summarizeWeek(sets,boundsA), b=summarizeWeek(sets,boundsB);
      const names=[...new Set([...a.keys(),...b.keys()])].sort((x,y)=>x.localeCompare(y,'ru'));
      if(!names.length){ result.replaceChildren(element('p','В этих неделях нет датированных подходов.')); return; }
      const total = m => [...m.values()].reduce((t,g)=>({kg:t.kg+g.kg,count:t.count+g.count,estimated:t.estimated+g.estimated,unknown:t.unknown+g.unknown}),{kg:0,count:0,estimated:0,unknown:0});
      function comparison(name,x,y) {
        const delta = x?.count && y?.count ? y.kg-x.kg : null;
        return [name, metric(x), metric(y), delta === null ? '—' : (delta>0?'+':'')+show(delta,'кг')];
      }
      result.replaceChildren(makeHistoryTable('Сравнение нагрузки',['Упражнение',shortDate.format(boundsA[0]),shortDate.format(boundsB[0]),'Разница'],
        [comparison('Всего',total(a),total(b)),...names.map(name=>comparison(name,a.get(name),b.get(name)))]));
    }
    [first,second].forEach(input=>input.addEventListener('change',render));
    render();
  }

  const dialog = document.getElementById('training-tools-dialog');
  document.getElementById('training-tools-close').addEventListener('click', () => {
    dialog.close();
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-training-tools]');
    if (!button) return;
    const target = button.classList.contains('training-plate-weight')
      ? Number(button.textContent.match(/^\d+(?:[.,]\d+)?/)?.[0].replace(',', '.')) : NaN;
    open(button.dataset.trainingTools, Number.isFinite(target) && target > 0 ? { target } : {});
  });
})();
