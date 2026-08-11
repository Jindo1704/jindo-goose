const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    // 사이트에 접속하면 기본적으로 'lobby' 방에 입장시킵니다.
    socket.join('lobby');

    const sendRoomList = () => {
        const roomList = Object.keys(rooms).map(roomName => ({
            roomName, userCount: rooms[roomName].users.length
        }));
        io.emit('room_list', roomList);
    };
    sendRoomList();

    // 로비 전용 채팅
    socket.on('send_lobby_chat', (data) => {
        io.to('lobby').emit('receive_lobby_chat', data);
    });

    socket.on('create_room', (data) => {
        if (rooms[data.room]) return socket.emit('room_error', '이미 존재하는 방 이름입니다.');
        rooms[data.room] = { password: data.password, users: [], snapshots: [] };
        sendRoomList();
        socket.emit('room_created', data.room);
    });

    socket.on('join_room', (data) => {
        const room = rooms[data.room];
        if (!room) return socket.emit('room_error', '존재하지 않는 방입니다.');
        if (room.password !== data.password) return socket.emit('room_error', '비밀번호가 틀렸습니다.');

        // 게임 방에 들어가면 로비 채팅방에서는 나갑니다.
        socket.leave('lobby');
        socket.join(data.room);
        
        socket.room = data.room;
        socket.nickname = data.nickname;
        socket.color = data.color; 

        room.users.push({ id: socket.id, nickname: data.nickname, color: data.color });
        
        io.to(data.room).emit('update_user_list', room.users);
        io.to(data.room).emit('receive_chat', { sender: '📢 시스템', msg: `${data.nickname}님이 입장하셨습니다.`, color: '#a6adc8' });
        socket.emit('update_snapshots', room.snapshots);
        
        socket.emit('join_success', data.room);
        sendRoomList();
    });

    socket.on('send_chat', (data) => {
        if (socket.room) {
            io.to(socket.room).emit('receive_chat', { sender: socket.nickname, msg: data.msg, color: socket.color });
        }
    });

    socket.on('mouse_move', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('update_mouse', {
                id: socket.id, x: data.x, y: data.y, nickname: socket.nickname, color: socket.color
            });
        }
    });

    socket.on('save_snapshot', (data) => {
        if (socket.room && rooms[socket.room]) {
            const room = rooms[socket.room];
            const snapshotName = `Round ${room.snapshots.length + 1} (${new Date().toLocaleTimeString('ko-KR')})`;
            room.snapshots.push({ name: snapshotName, data: data.snapshotData });
            io.to(socket.room).emit('update_snapshots', room.snapshots);
            io.to(socket.room).emit('receive_chat', { sender: '📸 시스템', msg: `[${snapshotName}] 미니맵이 저장되었습니다.`, color: '#a6e3a1' });
        }
    });

    socket.on('update_input', (data) => socket.to(socket.room).emit('receive_input', data));
    socket.on('move_marker', (data) => socket.to(socket.room).emit('update_marker', data));
    socket.on('add_corpse', (data) => socket.to(socket.room).emit('receive_add_corpse', data));
    socket.on('remove_corpse', (data) => socket.to(socket.room).emit('receive_remove_corpse', data));
    socket.on('reset_markers', () => socket.to(socket.room).emit('receive_reset_markers'));
    socket.on('reset_all', () => socket.to(socket.room).emit('receive_reset_all'));

    socket.on('disconnect', () => {
        if (socket.room && rooms[socket.room]) {
            const room = rooms[socket.room];
            room.users = room.users.filter(u => u.id !== socket.id);
            
            io.to(socket.room).emit('update_user_list', room.users);
            io.to(socket.room).emit('receive_chat', { sender: '📢 시스템', msg: `${socket.nickname}님이 퇴장하셨습니다.`, color: '#f38ba8' });
            io.to(socket.room).emit('remove_cursor', socket.id);
            
            if (room.users.length === 0) delete rooms[socket.room];
            sendRoomList();
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`서버 실행됨: ${PORT}`));
